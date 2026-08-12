# KubeNova

**Kubernetes monitoring reimagined as a 3D space fleet.**

<p align="center">
  <img src="docs/screenshots/kubenova-ui-simulator-high-traffic.png" alt="KubeNova fleet in high-traffic storm" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/kubenova-ui-demo-crew-view.png" alt="KubeNova crew panel" width="100%">
</p>

<p align="center">
  <video src="docs/screenshots/simulator-demo.mp4" autoplay loop muted playsinline width="100%"></video>
</p>

Instead of dashboards and graphs, you command an armada — nodes are capital ships, pods are fighter craft flying in squadron formations around each vessel. The captain announces alerts. Nebula storm intensity reflects cluster health. When pods crash, they explode in the void.

> This is an early preview. The core 3D visualization works and the eBPF agent is functional. A lot is still being built.

---

## Inspiration

I was fascinated by *Ender's Game* — both the book and the film. The idea that a commander could observe an entire battle as a living, moving system, understand its state at a glance, and act on instinct rather than spreadsheets. That's what I wanted for Kubernetes. Your cluster deserves the same kind of situational awareness Ender had in the Command Room.

## The Idea

Your cluster is alive — nodes humming, pods spawning, traffic flowing between services. KubeNova makes that visible as something beautiful: a space fleet drifting through the void, fighter craft in formation, nebula storms swelling when things get rough.

Put it on a screen in the office. Let it run. Glance at it. You'll know.

| KubeNova | Kubernetes |
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

### Option 1 — SIM mode, no cluster needed (30 seconds)

Just Node.js required.

```bash
git clone https://github.com/david6983/kubenova.git
cd kubenova/ui
npm install
npm run dev
# open http://localhost:5173
```

Toggle **SIM** in the top-right corner. The simulation fires random events: pod crashes, node flapping, traffic spikes, crashloop storms.

---

### Option 2 — Live mode, local dev

**A) Simplest: two terminals**

Requirements: `kubectl` configured against any running cluster, Node.js 20+.

```bash
# Terminal 1 — backend (point at your cluster context)
cd kubenova/ui
npm install
KUBENOVA_CONTEXT=my-cluster node server.js

# Terminal 2 — UI
npm run dev
# open http://localhost:5173 → toggle LIVE
```

`KUBENOVA_CONTEXT` is optional — leave it unset to use the current kubeconfig context.

**B) Full stack via Docker Compose (builds images from source)**

Requirements: Docker, kubectl configured.

```bash
KUBENOVA_CONTEXT=my-cluster docker compose up --build
# open http://localhost:8080 → toggle LIVE
```

**C) Demo cluster with eBPF metrics** (KinD + real pod CPU/mem + network flows)

Requirements: Docker, `kind`, `kubectl`, `make`, Node.js 20+.

```bash
# Spin up the bundled demo cluster
kind create cluster --name shopnova-prod --config k8s/shopnova-prod/kind-config.yaml
kubectl apply -f k8s/shopnova-prod/namespaces.yaml
kubectl apply -f k8s/shopnova-prod/workloads/
kubectl apply -f k8s/shopnova-prod/limitrange.yaml

# Deploy the eBPF agent DaemonSet
cd ebpf-agent && make deploy && cd ..

# Start backend + UI
cd ui && npm install
KUBENOVA_CONTEXT=kind-shopnova-prod node server.js &
npm run dev
# open http://localhost:5173 → toggle LIVE
```

---

### Option 3 — Install in your cluster via Helm

Requirements: Helm 3, `kubectl` configured against your cluster, images available in a registry.

**Build and push images first** (GitHub Actions does this automatically on push to `main`):

```bash
# Or build manually and push to any registry you control
docker build -t ghcr.io/david6983/kubenova-ui:latest     ui/ -f ui/Dockerfile
docker build -t ghcr.io/david6983/kubenova-server:latest ui/ -f ui/Dockerfile.server
docker build -t ghcr.io/david6983/kubenova-ebpf-agent:latest ebpf-agent/ -f ebpf-agent/Dockerfile
docker push ghcr.io/david6983/kubenova-ui:latest
docker push ghcr.io/david6983/kubenova-server:latest
docker push ghcr.io/david6983/kubenova-ebpf-agent:latest
```

**Install with Helm:**

```bash
helm install kubenova ./charts/kubenova \
  -n kubenova \
  --create-namespace \
  --set image.org=david6983 \
  --set ingress.enabled=true \
  --set ingress.host=kubenova.yourcompany.com
```

The eBPF DaemonSet is enabled by default — it needs a real Linux kernel (any standard cloud cluster works). On macOS KinD or without eBPF support:

```bash
--set ebpfAgent.enabled=false
```

**Kustomize alternative** (no Helm):

```bash
# Edit k8s/kubenova/*.yaml to replace david6983 with your registry org
kubectl apply -k k8s/kubenova/
kubectl apply -f ebpf-agent/deploy/daemonset.yaml
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
