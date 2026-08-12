# KubeBoat — Vision

## The Idea

Your cluster is alive — nodes humming, pods spawning, traffic flowing between services. Most people never see it. They see Grafana dashboards, tables, and status pages.

KubeBoat makes the cluster **visible as something beautiful**: a space fleet drifting through the void. Fighter craft in tight formations. Nebula storms intensifying when the fleet is under pressure. The captain's voice cutting through when something goes wrong.

Put it on a screen in the office. Let it run. Glance at it. You'll know.

It's for people who love space — and happen to run Kubernetes.

---

## The Metaphor

| KubeBoat world | Kubernetes |
|---|---|
| Deep space | Infrastructure / cloud |
| A fleet | A cluster |
| The command ship | The control plane |
| The Captain | kube-apiserver — orchestrates everything |
| Capital ships | Worker nodes |
| Fighter craft | Pods |
| Crew aboard | The Ops team (SRE, Staff Eng…) |

---

## The Ships

Not all ships look the same — the workload type dictates the vessel class:

- **Destroyer** — the standard workload (Deployment), most common in the fleet
- **Heavy cruiser** — stateful workloads (databases, storage); anchored in formation, protected, precious
- **Patrol craft** — periodic jobs (CronJob); leaves on a mission, comes back, disappears between runs
- **Command ship** — the control plane; larger, central, visually distinct

---

## What You See

**Strategic view:**
Fighter craft fly in tight squadron formations around their capital ship. A crashing pod doesn't drift away — it explodes in the void, a system goes dark, engineers scramble to it.

**Interior view:**
Zooming into a ship takes you inside. Each compartment is a pod, each operator at their station is a container. The state of every compartment reflects the health of the workload.

**Traffic:**
- Requests coming from the outside arrive as **incoming fire from deep space** — blurry origin, just like real web traffic
- Service-to-service traffic appears as an **animated flow overlay** between ships — you see who talks to whom

**The crew:**
Aboard each ship, the Ops team is represented. Each member has their role visible: SRE, Staff Engineer, Platform Engineer. They react to incidents — when something's burning, they scramble.

---

## Views

The 3D scene can be filtered by layer depending on what you want to observe:

- **Operations** — overall state, ship health, active alerts
- **Network** — incoming traffic and inter-service flows
- **Security** — ranks, access, RBAC (the "command staff" view)
- **Team** — the crew, roles, activity

---

## Roadmap

### Step 1 — Observe (MVP)
You watch. It's beautiful. It's readable. One cluster, one fleet, strategic view. The captain announces events. Open source from day one.

### Step 2 — Explore
Drill into details. Interior view of ships. Crew aboard. Network traffic visible. Multi-namespace support (colored squadrons).

### Step 3 — Multi-cluster
Multiple fleets across the same sector. Navigate between clusters.

### Step 4 — Play
Fleet vs fleet. Red team attacks, blue team defends. Chaos engineering as torpedo strikes. Kubernetes learning mode. Multiplayer.

---

## The Ambition

An open source tool that makes Kubernetes monitoring instinctive and enjoyable — and that could become, later, the best way to learn Kubernetes by living it rather than reading about it.
