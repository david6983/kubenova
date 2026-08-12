# KubeNova — Agent Handoff Guide

KubeNova is a 3D Kubernetes cluster visualizer styled as a space fleet. Instead of dashboards and graphs, operators command a fleet: nodes are warships, pods are fighter craft flying in squadron formations around each ship.

---

## Tech Stack

- **React 18** + **TypeScript** (strict)
- **React Three Fiber** (`@react-three/fiber`) — 3D rendering
- **@react-three/drei** — OrbitControls, Html, useGLTF
- **@react-three/postprocessing** — Bloom effect
- **Three.js** — InstancedMesh, materials, geometry
- **Vite** — build/dev server (`npm run dev` from `ui/`)
- **Node.js** backend (`ui/server.js`) — polls kubectl + proxies eBPF agent data
- **Go** eBPF agent (`ebpf-agent/`) — real pod metrics + network flows via TC hooks

---

## Repository Layout

```
kubenova/
├── ui/                        # Vite + React app
│   ├── server.js              # Node.js backend: kubectl + eBPF agent proxy
│   ├── src/
│   │   ├── types.ts           # Core types: Pod, ClusterNode, Cluster
│   │   ├── App.tsx            # Root: state, cluster sim, wires Scene + HUD
│   │   ├── scene/
│   │   │   ├── Scene.tsx      # Canvas setup, camera, OrbitControls, Bloom
│   │   │   ├── Fleet.tsx      # Renders all ships, service graph, positions
│   │   │   ├── Ship.tsx       # Individual warship GLTF + PodRing + animations
│   │   │   ├── PodRing.tsx    # Pod squadrons as InstancedMesh fighters
│   │   │   ├── Traffic.tsx    # East-West service mesh flows (particles)
│   │   │   ├── NorthSouth.tsx # North-South inbound traffic (missiles/projectiles)
│   │   │   ├── PodTraffic.tsx # Pod-level traffic overlay
│   │   │   ├── Weather.tsx    # Particle storm — intensity = cluster health
│   │   │   ├── Space.tsx      # Starfield background
│   │   │   ├── Decorations.tsx
│   │   │   ├── Captain.tsx    # AI captain event announcements (not yet wired)
│   │   │   └── InteriorScene.tsx  # Interior view (in progress)
│   │   ├── hud/
│   │   │   ├── HUD.tsx        # All 2D overlays: fleet stats, controls, legend
│   │   │   └── NodeDetailPanel.tsx  # Right-side panel (in progress)
│   │   ├── hooks/
│   │   │   └── useRealCluster.ts   # Live cluster data via server.js WebSocket
│   │   ├── mock/
│   │   │   ├── cluster.ts          # Static mock: 23 nodes, ~321 pods
│   │   │   └── useSimulatedCluster.ts  # Simulates live events (crashloops, evictions…)
│   │   └── constants/
│   │       └── namespaces.ts  # Namespace → color mapping
│   └── public/models/         # GLTF ship and pod models
│       ├── Bob/               # Pod fighter (Deployment)
│       ├── Pancake/           # Pod fighter (StatefulSet)
│       ├── Striker/           # Pod fighter (DaemonSet)
│       ├── Challenger/        # Worker ship model variant
│       ├── Executioner/
│       ├── Omen/
│       ├── Insurgent/
│       └── [CP ship models]   # Control-plane ships (larger/distinct)
├── ebpf-agent/                # Go DaemonSet — real pod metrics + network flows
│   ├── main.go                # Agent: eBPF attach, k8s API discovery, HTTP server
│   ├── bpf/flow_tracker.c     # BPF program: TC egress hook, flow LRU map
│   ├── deploy/daemonset.yaml  # K8s RBAC + DaemonSet manifest
│   └── Makefile               # generate / build / load / deploy / logs
├── chaos-agent/               # Node.js chaos controller
│   ├── chaos.js               # Pod kill, CPU pressure, traffic level logic
│   └── server.js              # HTTP API: POST /config, GET /status
└── k8s/shopnova-prod/         # Demo KinD cluster manifests
    ├── kind-config.yaml        # 5-node cluster definition
    ├── namespaces.yaml
    ├── limitrange.yaml
    └── workloads/             # nginx + traffic-gen deployments
```

---

## Core Data Model

```ts
// types.ts
interface Pod {
  id: string; name: string; namespace: string
  status: 'running' | 'pending' | 'failed' | 'crashloop'
  cpuPct: number; memPct: number          // 0–1
  workloadKind: 'deployment' | 'statefulset' | 'daemonset' | 'other'
}
interface ClusterNode {
  id: string; name: string
  role: 'control-plane' | 'worker'
  cpuPct: number; memPct: number; ready: boolean
  pods: Pod[]
}
interface Cluster { name: string; nodes: ClusterNode[] }
```

---

## Key Architecture Decisions

### Fleet Layout
- **3 control-plane nodes** → `CP_POSITIONS` in `Fleet.tsx` (rear/center formation)
- **20 worker nodes** → `WORKER_POSITIONS` in `Fleet.tsx` (scaled ×1.75 for visual spread)
- Node world position is computed by iterating `cluster.nodes` in order and tracking `cpIdx`/`wIdx`
- `getNodeWorldPos(node, cluster)` is exported from `Fleet.tsx` for camera targeting

### Pod Squadrons (PodRing.tsx)
Pods group by workload using `name.replace(/-[a-z0-9]{1,5}$/, '')` to strip the replica suffix.
Each workload gets its own **mini triangle formation** (`miniPyramid`).
Formations lay out in 2 columns (left = even-index workloads, right = odd-index).

```ts
podSpacing = Math.max(10, 8 + Math.pow(pods.length, 0.38))  // scales with pod count
colX       = Math.max(30, 22 + Math.pow(pods.length, 0.45)) // column separation
```

Pod models: **Bob** (Deployment), **Pancake** (StatefulSet), **Striker** (DaemonSet).
All rendered via `InstancedMesh` for performance.

### Node Focus / Camera
When a node is clicked (`App.tsx → openNode`):
1. `selectedNode` state is set → passed down to `Scene` and `Fleet`
2. `NodeFocusCamera` (inside `Canvas` in `Scene.tsx`) lerps camera to `[nx, 210, nz - 55]`, target `[nx, 0, nz + 10]` — elevated top-down view behind the ship
3. `Fleet` passes `dimmed=true` to all ships except the selected one
4. A minimal HUD label appears at top-center (name, status, pod count)
5. ESC returns to full fleet view

Camera constraint: `maxPolarAngle = Math.PI * 0.48` prevents gimbal flip when orbiting near overhead.

### Health & Simulation
`computeHealth(cluster)` → `'good' | 'warn' | 'critical'`  
`applyTrafficLevel(cluster, level)` → scales CPU/MEM, triggers crashloops at high traffic (w-12, w-13).  
`useSimulatedCluster` fires random events (pod evictions, crashloops, node flapping) on a timer.

---

## Namespace → Color

Defined in `src/constants/namespaces.ts`. Key namespaces:

| namespace | color |
|---|---|
| production | #00b4ff |
| payments | #ff3366 |
| data | #cc44ff |
| monitoring | #ffaa00 |
| search | #ff9933 |
| messaging | #cc44ff |
| ml | #aa44ff |
| kube-system | #4488ff |

---

## Mock Cluster (`src/mock/cluster.ts`)

23 nodes total:
- `cp-0`, `cp-1`, `cp-2` — control plane
- `w-0` to `w-19` — workers

Notable failure states baked in:
- `w-7` — `refund-worker` in CrashLoopBackOff
- `w-13` — `model-serving` failed
- `w-19` — NotReady (vault pod failed)

---

## Roadmap

### Phase 1 — MVP ✅ nearly complete
- [x] 3D fleet, ships = nodes, pods = fighter craft in squadrons
- [x] Per-workload triangle formations, 2-column layout
- [x] East-West traffic flows (service graph)
- [x] North-South inbound traffic
- [x] Weather system (storm intensity = cluster health)
- [x] HUD: namespace legend, alert log, health states
- [x] Node focus: camera lerp + fleet dimming on click
- [x] Mock cluster (~321 pods, realistic namespaces)
- [ ] **AI Captain** — voice/text announcements for K8s events (Captain.tsx exists, not wired)

### Phase 2 — Drill Down + Team
- [ ] **Ops crew on deck** — sailor figures representing SRE/Platform team members, react to incidents
- [ ] StatefulSet ships visually distinct from Deployments
- [ ] CronJob pods as patrol ships (appear/disappear on schedule)

### Phase 3 — Multi-Cluster
- [ ] Multiple fleets on same space map
- [ ] Fleet-to-fleet navigation

### Phase 4 — Game Mode
- [ ] Chaos engineering as torpedo attacks
- [ ] Red team / blue team
- [ ] OIDC auth grades (Admiral / Captain / Sailor)

---

## Coding Rules

- **English only** in all code, comments, variable names, and documentation
- No comments unless the WHY is non-obvious
- TypeScript strict — run `npx tsc --noEmit` after every change
- Prefer editing existing files over creating new ones
- Do not add abstractions or error handling beyond what's needed
- Three.js objects created in `useMemo` must be disposed in `useEffect` cleanup

---

## Running the Project

```bash
cd ui
npm install
npm run dev      # http://localhost:5173
npx tsc --noEmit # type check
```
