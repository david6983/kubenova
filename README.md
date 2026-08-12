# KubeBoat

**Kubernetes monitoring reimagined as a 3D space fleet.**

Instead of dashboards and graphs, you command an armada — nodes are capital ships, pods are fighter craft flying in squadron formations around each vessel. The captain announces alerts. Nebula storm intensity reflects cluster health. When pods crash, they explode in the void.

> This is an early preview. The core 3D visualization works and the eBPF agent is functional. A lot is still being built.

---

## The Idea

Grafana works. But staring at grey dashboards at 2am is exhausting. Understanding cluster state from gauges and graphs is a skill acquired through suffering — not something instinctive.

KubeBoat makes cluster state **readable at a glance**. You see it. You feel it.

| KubeBoat | Kubernetes |
|---|---|
| Deep space | Infrastructure / cloud |
| A fleet | A cluster |
| The command ship | Control plane |
| Capital ships | Worker nodes |
| Fighter craft | Pods |
| Nebula storm | Cluster health |
| Crew aboard | Your ops team |

---

## Quick Start

### Simulation mode — no cluster needed

```bash
cd ui
npm install
npm run dev
# open http://localhost:5173
```

Toggle **SIM** in the top-right corner. The simulation fires random events: pod crashes, node flapping, traffic spikes, crashloop storms.

### Live mode — real Kubernetes cluster

Requirements: `kubectl` installed and configured against a running cluster.

```bash
# Terminal 1 — backend
cd ui
npm install
node server.js

# Terminal 2 — UI
npm run dev
```

Open http://localhost:5173 and toggle **LIVE**.

### With real eBPF metrics

The eBPF agent runs as a DaemonSet and reports real pod CPU/memory and pod-to-pod network flows. Requires a Linux cluster (KinD works on macOS via Docker).

```bash
# Create a demo cluster (optional — uses the shopnova-prod example)
kind create cluster --name shopnova-prod --config k8s/shopnova-prod/kind-config.yaml
kubectl apply -f k8s/shopnova-prod/namespaces.yaml
kubectl apply -f k8s/shopnova-prod/workloads/
kubectl apply -f k8s/shopnova-prod/limitrange.yaml

# Build and deploy the eBPF agent
cd ebpf-agent
make deploy

# Start the backend + UI
cd ../ui && node server.js &
npm run dev
```

---

## What's in the Box

| Directory | What it does |
|---|---|
| `ui/` | React + Three.js 3D fleet visualization |
| `ui/server.js` | Node.js backend — polls kubectl, proxies eBPF agent |
| `ebpf-agent/` | Go DaemonSet — real pod metrics + network flows via eBPF TC hooks |
| `chaos-agent/` | Injects chaos into the cluster (pod kills, CPU pressure) |
| `k8s/shopnova-prod/` | Demo KinD cluster — 5 nodes, 20+ nginx workloads, live traffic generator |
| `assets/models/` | Source 3D models (CC0, by @Quaternius) |

---

## Architecture

```
Kubernetes cluster
  └─ ebpf-agent DaemonSet (Go)
       ├─ TC egress eBPF hooks  → pod-to-pod network flows
       ├─ cgroupv2              → real CPU / memory per pod
       └─ k8s API              → pod discovery
       exposes :7777 (HTTP + WebSocket)

ui/server.js (Node.js, :3001)
  ├─ kubectl          → cluster topology (nodes, pods, events)
  ├─ kube-apiserver proxy → eBPF agent metrics
  └─ WebSocket        → pushes { cluster, events } to UI every 2s

ui/ (React + Three.js, :5173)
  ├─ SIM mode  — fully offline, seeded simulation
  └─ LIVE mode — real cluster via server.js WebSocket
```

The eBPF agent attaches TC egress hooks to every pod veth interface, maintains a BPF LRU hash map keyed by (src_ip, dst_ip, src_port, dst_port, proto), and resolves IPs against the Kubernetes API — including ClusterIPs — to produce named pod-to-pod flows.

---

## Roadmap

### Step 1 — Observe (in progress)
- [x] 3D space fleet: nodes as capital ships, pods as fighter craft in formations
- [x] East-West traffic flows between ships
- [x] North-South inbound traffic (fire from deep space)
- [x] Nebula storm system: storm intensity = cluster health
- [x] HUD: namespace legend, alert log, node detail panel
- [x] Real eBPF agent: pod CPU/mem + network flows
- [x] Demo cluster with realistic workloads and live traffic
- [ ] AI Captain voice/text announcements for K8s events
- [ ] Wire real eBPF flows into traffic visualization

### Step 2 — Explore
- [ ] Interior ship view: each compartment = a pod
- [ ] Crew aboard: SRE/Platform team figures that react to incidents
- [ ] StatefulSet ships visually distinct (heavy cruisers)
- [ ] CronJob pods as patrol craft (appear on schedule, then vanish)

### Step 3 — Multi-cluster
- [ ] Multiple fleets across the same sector
- [ ] Fleet-to-fleet navigation

### Step 4 — Game Mode
- [ ] Chaos engineering as torpedo strikes
- [ ] Red team / blue team
- [ ] RBAC as military ranks (Admiral, Captain, Ensign)
- [ ] Kubernetes learning mode

---

## Contributing

This project is in early development. The best way to contribute right now:

1. **Try it** — run simulation mode, open an issue if something looks broken
2. **Ideas** — open a discussion for features you want to see
3. **Code** — check open issues; the roadmap items above are all up for grabs

See `AGENTS.md` for codebase architecture and coding rules.

---

## License

MIT — see [LICENSE](LICENSE).

3D models are CC0 (public domain) by [@Quaternius](https://www.patreon.com/quaternius).
