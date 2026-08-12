//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -target bpf" FlowTracker bpf/flow_tracker.c

package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/rlimit"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type NetworkFlow struct {
	SrcPod      string  `json:"srcPod"`
	SrcNs       string  `json:"srcNs"`
	DstPod      string  `json:"dstPod"`
	DstNs       string  `json:"dstNs"`
	BytesPerSec float64 `json:"bytesPerSec"`
	Packets     uint64  `json:"packets"`
	LatencyMs   float64 `json:"latencyMs"` // reserved, 0 until we have RTT
}

type PodMetric struct {
	Pod    string  `json:"pod"`
	Ns     string  `json:"ns"`
	Node   string  `json:"node"`
	CpuPct float64 `json:"cpuPct"`
	MemPct float64 `json:"memPct"`
}

type Snapshot struct {
	Flows      []NetworkFlow `json:"flows"`
	PodMetrics []PodMetric   `json:"podMetrics"`
	UpdatedAt  time.Time     `json:"updatedAt"`
	Node       string        `json:"node"`
}

// ── Pod IP / cgroup index ─────────────────────────────────────────────────────

type podInfo struct {
	name      string
	namespace string
	uid       string
	ip        string
}

const (
	saTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	saCAPath    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
)

// k8sAPIBase returns the API server base URL using injected env vars,
// avoiding DNS resolution which fails with hostNetwork: true.
func k8sAPIBase() string {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" {
		host = "kubernetes.default.svc"
	}
	if port == "" {
		port = "443"
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return "https://" + host + ":" + port
}

var k8sClient *http.Client

func initK8sClient() {
	caData, err := os.ReadFile(saCAPath)
	if err != nil {
		log.Printf("[k8s] no CA cert, using insecure client: %v", err)
		k8sClient = &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		}
		return
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caData)
	k8sClient = &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool},
		},
	}
}

// discoverPods queries the Kubernetes API server (in-cluster service account)
// for pods scheduled on this node, building an ip→podInfo map.
func discoverPods() map[string]podInfo {
	pods := map[string]podInfo{}

	token, err := os.ReadFile(saTokenPath)
	if err != nil {
		log.Printf("[pods] no service account token: %v", err)
		return pods
	}

	url := k8sAPIBase() + "/api/v1/pods"
	if nodeName := os.Getenv("NODE_NAME"); nodeName != "" {
		url += "?fieldSelector=spec.nodeName=" + nodeName
	}

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))

	resp, err := k8sClient.Do(req)
	if err != nil {
		log.Printf("[pods] k8s API error: %v", err)
		return pods
	}
	defer resp.Body.Close()

	var body struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
				UID       string `json:"uid"`
			} `json:"metadata"`
			Status struct {
				PodIP string `json:"podIP"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		log.Printf("[pods] decode error: %v", err)
		return pods
	}

	for _, item := range body.Items {
		if item.Status.PodIP == "" {
			continue
		}
		pods[item.Status.PodIP] = podInfo{
			name:      item.Metadata.Name,
			namespace: item.Metadata.Namespace,
			uid:       item.Metadata.UID,
			ip:        item.Status.PodIP,
		}
	}
	return pods
}

// discoverClusterIPs returns clusterIP → podInfo (using the service name as the
// pod identity, so flows show "traffic-gen → shop-api" not a raw pod hash).
// Pre-DNAT TC egress hooks see ClusterIPs as destinations; this resolves them.
func discoverClusterIPs() map[string]podInfo {
	clusterIPs := map[string]podInfo{}

	token, err := os.ReadFile(saTokenPath)
	if err != nil {
		return clusterIPs
	}
	bearer := "Bearer " + strings.TrimSpace(string(token))

	req, _ := http.NewRequest("GET", k8sAPIBase()+"/api/v1/services", nil)
	req.Header.Set("Authorization", bearer)
	resp, err := k8sClient.Do(req)
	if err != nil {
		return clusterIPs
	}
	defer resp.Body.Close()

	var body struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				ClusterIP string `json:"clusterIP"`
			} `json:"spec"`
		} `json:"items"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil {
		return clusterIPs
	}
	for _, svc := range body.Items {
		if svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == "None" {
			continue
		}
		clusterIPs[svc.Spec.ClusterIP] = podInfo{
			name:      svc.Metadata.Name,
			namespace: svc.Metadata.Namespace,
			ip:        svc.Spec.ClusterIP,
		}
	}
	return clusterIPs
}

// ── cgroup v2 CPU / mem ───────────────────────────────────────────────────────

const cgroupRoot = "/sys/fs/cgroup"

// cgroupPaths returns all leaf cgroup paths that look like pod containers.
// KinD uses cgroupv2 with systemd driver: kubepods.slice/.../crio-<id>.scope
func cgroupPaths() []string {
	var paths []string
	filepath.Walk(cgroupRoot, func(p string, fi os.FileInfo, err error) error {
		if err != nil || !fi.IsDir() {
			return nil
		}
		if strings.Contains(p, "kubepods") && strings.HasSuffix(p, ".scope") {
			paths = append(paths, p)
		}
		return nil
	})
	return paths
}

// readCPUStat parses cpu.stat and returns usage_usec.
func readCPUStat(cgPath string) (uint64, error) {
	data, err := os.ReadFile(filepath.Join(cgPath, "cpu.stat"))
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "usage_usec ") {
			v, err := strconv.ParseUint(strings.TrimPrefix(line, "usage_usec "), 10, 64)
			return v, err
		}
	}
	return 0, fmt.Errorf("usage_usec not found")
}

// readMemCurrent returns current memory in bytes.
func readMemCurrent(cgPath string) (uint64, error) {
	data, err := os.ReadFile(filepath.Join(cgPath, "memory.current"))
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
}

type cgSample struct {
	usageUsec uint64
	at        time.Time
}

// cgroupCollector tracks CPU delta across samples.
type cgroupCollector struct {
	mu      sync.Mutex
	prev    map[string]cgSample // cgPath → last sample
	nodeCPU int                 // number of logical CPUs
	nodeMem uint64              // total node memory in bytes
}

func newCgroupCollector() *cgroupCollector {
	cpuCount := 4 // default; try to read from cgroup
	if data, err := os.ReadFile("/sys/fs/cgroup/cpu.max"); err == nil {
		parts := strings.Fields(string(data))
		if len(parts) == 2 {
			period, _ := strconv.ParseUint(parts[1], 10, 64)
			_ = period
		}
	}
	// Use nproc equivalent
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		cpuCount = strings.Count(string(data), "processor\t:")
		if cpuCount == 0 {
			cpuCount = 4
		}
	}

	// Node total memory
	var nodeMem uint64 = 8 * 1024 * 1024 * 1024
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					kb, _ := strconv.ParseUint(fields[1], 10, 64)
					nodeMem = kb * 1024
				}
				break
			}
		}
	}

	return &cgroupCollector{
		prev:    make(map[string]cgSample),
		nodeCPU: cpuCount,
		nodeMem: nodeMem,
	}
}

// containerIDFromCgPath extracts the container ID from a cgroup path.
// e.g. .../crio-abc123.scope → abc123
func containerIDFromCgPath(p string) string {
	base := filepath.Base(p)
	base = strings.TrimSuffix(base, ".scope")
	// strip driver prefix (cri-containerd-, crio-, docker-, containerd-)
	for _, prefix := range []string{"cri-containerd-", "crio-", "docker-", "containerd-"} {
		if strings.HasPrefix(base, prefix) {
			return strings.TrimPrefix(base, prefix)
		}
	}
	return base
}

// uidFromCgPath extracts pod UID from a path segment like:
//   kubelet-kubepods-besteffort-pod<uid>.slice  (KinD / containerd)
//   kubepods-besteffort-pod<uid>.slice          (older crio)
// Systemd replaces "-" in UIDs with "_", so we reverse that.
func uidFromCgPath(p string) string {
	for _, seg := range strings.Split(p, string(os.PathSeparator)) {
		if !strings.HasSuffix(seg, ".slice") {
			continue
		}
		// Use LastIndex to find the "-pod" prefix closest to the UID
		idx := strings.LastIndex(seg, "-pod")
		if idx < 0 {
			continue
		}
		uid := strings.TrimSuffix(seg[idx+4:], ".slice")
		uid = strings.ReplaceAll(uid, "_", "-")
		if len(uid) >= 32 {
			return uid
		}
	}
	return ""
}

func (c *cgroupCollector) collect(pods map[string]podInfo) []PodMetric {
	// Build uid → podInfo for fast lookup
	byUID := make(map[string]podInfo, len(pods))
	for _, p := range pods {
		byUID[p.uid] = p
	}

	nodeName, _ := os.Hostname()
	now := time.Now()

	c.mu.Lock()
	defer c.mu.Unlock()

	var metrics []PodMetric
	for _, cgPath := range cgroupPaths() {
		uid := uidFromCgPath(cgPath)
		if uid == "" {
			continue
		}
		info, ok := byUID[uid]
		if !ok {
			continue
		}

		usageUsec, err := readCPUStat(cgPath)
		if err != nil {
			continue
		}
		memBytes, err := readMemCurrent(cgPath)
		if err != nil {
			continue
		}

		var cpuPct float64
		if prev, hasPrev := c.prev[cgPath]; hasPrev {
			dt := now.Sub(prev.at).Seconds()
			if dt > 0 {
				deltaMicros := float64(usageUsec - prev.usageUsec)
				cpuPct = (deltaMicros / 1e6) / (dt * float64(c.nodeCPU))
				if cpuPct > 1 {
					cpuPct = 1
				}
			}
		}
		c.prev[cgPath] = cgSample{usageUsec: usageUsec, at: now}

		memPct := float64(memBytes) / float64(c.nodeMem)
		if memPct > 1 {
			memPct = 1
		}

		metrics = append(metrics, PodMetric{
			Pod:    info.name,
			Ns:     info.namespace,
			Node:   nodeName,
			CpuPct: cpuPct,
			MemPct: memPct,
		})
	}
	return metrics
}

// ── TC attachment ─────────────────────────────────────────────────────────────

type tcAttachment struct {
	iface string
	link  link.Link
}

// attachTC attaches the TC egress program to a network interface via TCX (kernel ≥ 6.6).
// Docker Desktop on macOS ships kernel 6.6+, so TCX is always available in KinD.
func attachTC(iface string, prog *ebpf.Program) (link.Link, error) {
	ifi, err := net.InterfaceByName(iface)
	if err != nil {
		return nil, fmt.Errorf("interface %s: %w", iface, err)
	}
	return link.AttachTCX(link.TCXOptions{
		Interface: ifi.Index,
		Program:   prog,
		Attach:    ebpf.AttachTCXEgress,
	})
}

// vethInterfaces returns all veth interfaces on the host (pod network interfaces).
func vethInterfaces() []string {
	ifaces, _ := net.Interfaces()
	var veths []string
	for _, iface := range ifaces {
		// veth names on KinD: veth<hex>, eth0, lxc-<id>
		name := iface.Name
		if strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "lxc") {
			veths = append(veths, name)
		}
	}
	return veths
}

// ── Broadcast state ───────────────────────────────────────────────────────────

type state struct {
	mu   sync.RWMutex
	snap Snapshot
	subs map[chan Snapshot]struct{}
}

func newState() *state {
	return &state{
		snap: Snapshot{Flows: []NetworkFlow{}, PodMetrics: []PodMetric{}},
		subs: make(map[chan Snapshot]struct{}),
	}
}

func (s *state) publish(snap Snapshot) {
	s.mu.Lock()
	s.snap = snap
	chs := make([]chan Snapshot, 0, len(s.subs))
	for ch := range s.subs {
		chs = append(chs, ch)
	}
	s.mu.Unlock()
	for _, ch := range chs {
		select {
		case ch <- snap:
		default:
		}
	}
}

func (s *state) subscribe() chan Snapshot {
	ch := make(chan Snapshot, 1)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

func (s *state) unsubscribe(ch chan Snapshot) {
	s.mu.Lock()
	delete(s.subs, ch)
	s.mu.Unlock()
}

func (s *state) latest() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snap
}

// ── Main collection loop ──────────────────────────────────────────────────────

func runAgent(ctx context.Context, objs *FlowTrackerObjects, cg *cgroupCollector, st *state) {
	nodeName, _ := os.Hostname()

	// Attach TC to all veth interfaces; re-check every 10s for new ones
	attachments := map[string]link.Link{}

	attachAll := func() {
		for _, iface := range vethInterfaces() {
			if _, ok := attachments[iface]; ok {
				continue
			}
			l, err := attachTC(iface, objs.TcEgress)
			if err != nil {
				log.Printf("[tc] attach %s: %v", iface, err)
				continue
			}
			attachments[iface] = l
			log.Printf("[tc] attached to %s", iface)
		}
	}
	attachAll()

	ticker   := time.NewTicker(2 * time.Second)
	reattach := time.NewTicker(10 * time.Second)
	podSync  := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	defer reattach.Stop()
	defer podSync.Stop()

	// Pod + ClusterIP cache — refreshed every 30s to avoid hammering the API server
	pods       := discoverPods()
	clusterIPs := discoverClusterIPs()
	podsMu     := sync.RWMutex{}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-podSync.C:
				freshPods := discoverPods()
				freshSvcs := discoverClusterIPs()
				podsMu.Lock()
				pods       = freshPods
				clusterIPs = freshSvcs
				podsMu.Unlock()
			}
		}
	}()

	// Track previous bytes per flow key for per-second rate
	type flowKey = FlowTrackerFlowKey
	prevBytes := map[flowKey]uint64{}
	prevAt    := time.Now()

	for {
		select {
		case <-ctx.Done():
			for _, l := range attachments {
				l.Close()
			}
			return

		case <-reattach.C:
			attachAll()

		case now := <-ticker.C:
			podsMu.RLock()
			currentPods := pods
			currentSvcs := clusterIPs
			podsMu.RUnlock()

			// BPF stores IPs in network byte order; Go reads map uint32s as
			// little-endian native — so we must use LittleEndian.Uint32 to match.
			ipKey := func(ipStr string) (uint32, bool) {
				ip := net.ParseIP(ipStr).To4()
				if ip == nil {
					return 0, false
				}
				return binary.LittleEndian.Uint32(ip), true
			}

			ipToPod := make(map[uint32]podInfo, len(currentPods)+len(currentSvcs))
			for ipStr, info := range currentSvcs {
				if k, ok := ipKey(ipStr); ok {
					ipToPod[k] = info
				}
			}
			for ipStr, info := range currentPods {
				if k, ok := ipKey(ipStr); ok {
					ipToPod[k] = info
				}
			}

			dt := now.Sub(prevAt).Seconds()
			prevAt = now

			// Read + clear flow map
			var flows []NetworkFlow
			var mapKey FlowTrackerFlowKey
			var mapVal FlowTrackerFlowVal
			iter := objs.Flows.Iterate()
			var keys []FlowTrackerFlowKey
			var vals []FlowTrackerFlowVal
			for iter.Next(&mapKey, &mapVal) {
				keys = append(keys, mapKey)
				vals = append(vals, mapVal)
			}

			// Aggregate by pod pair (collapse individual ports)
			type podPair struct{ src, dst string; srcNs, dstNs string }
			agg := map[podPair]*struct{ bytes, prevBytes uint64; packets uint64 }{}

			for i, k := range keys {
				v := vals[i]
				src, hasSrc := ipToPod[k.SrcIp]
				dst, hasDst := ipToPod[k.DstIp]
				if !hasSrc || !hasDst {
					continue
				}
				pair := podPair{src.name, dst.name, src.namespace, dst.namespace}
				if _, ok := agg[pair]; !ok {
					agg[pair] = &struct{ bytes, prevBytes uint64; packets uint64 }{}
				}
				agg[pair].bytes += v.Bytes
				agg[pair].packets += v.Packets

				// Per-key prev for rate
				portKey := FlowTrackerFlowKey{SrcIp: k.SrcIp, DstIp: k.DstIp, SrcPort: k.SrcPort, DstPort: k.DstPort, Proto: k.Proto}
				agg[pair].prevBytes += prevBytes[portKey]
				prevBytes[portKey] = v.Bytes
			}

			for pair, acc := range agg {
				var bps float64
				if dt > 0 && acc.bytes >= acc.prevBytes {
					bps = float64(acc.bytes-acc.prevBytes) / dt
				}
				flows = append(flows, NetworkFlow{
					SrcPod:      pair.src,
					SrcNs:       pair.srcNs,
					DstPod:      pair.dst,
					DstNs:       pair.dstNs,
					BytesPerSec: bps,
					Packets:     acc.packets,
				})
			}
			if flows == nil {
				flows = []NetworkFlow{}
			}

			metrics := cg.collect(currentPods)
			if metrics == nil {
				metrics = []PodMetric{}
			}

			st.publish(Snapshot{
				Flows:      flows,
				PodMetrics: metrics,
				UpdatedAt:  now,
				Node:       nodeName,
			})
			log.Printf("[agent] %d flows, %d pod metrics", len(flows), len(metrics))
		}
	}
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

func wsHandler(st *state) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := conn.CloseRead(r.Context())
		ch := st.subscribe()
		defer st.unsubscribe(ch)

		if err := wsjson.Write(ctx, conn, st.latest()); err != nil {
			return
		}
		for {
			select {
			case <-ctx.Done():
				return
			case snap, ok := <-ch:
				if !ok {
					return
				}
				if err := wsjson.Write(ctx, conn, snap); err != nil {
					return
				}
			}
		}
	}
}

func restHandler(st *state) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(st.latest())
	}
}

// ── Entry point ───────────────────────────────────────────────────────────────

func main() {
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":7777"
	}

	initK8sClient()

	// Remove memlock limit for BPF maps
	if err := rlimit.RemoveMemlock(); err != nil {
		log.Fatalf("[ebpf] remove memlock: %v", err)
	}

	// Load BPF objects (compiled by bpf2go into flowtracker_bpfeb/el.go)
	objs := &FlowTrackerObjects{}
	if err := LoadFlowTrackerObjects(objs, nil); err != nil {
		log.Fatalf("[ebpf] load objects: %v", err)
	}
	defer objs.Close()

	cg := newCgroupCollector()
	st := newState()

	ctx := context.Background()
	go runAgent(ctx, objs, cg, st)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws",      wsHandler(st))
	mux.HandleFunc("/metrics", restHandler(st))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	log.Printf("[ebpf-agent] listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
