import { Suspense, useMemo, useRef, memo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Ship, shipAnimRegistry } from './Ship'
import { Traffic } from './Traffic'
import { NorthSouth } from './NorthSouth'
import { PodTraffic } from './PodTraffic'
import type { Flow } from './Traffic'
import { dominantNamespace, getNsColor } from '../constants/namespaces'
import type { Cluster, ClusterNode } from '../types'

const CP_POSITIONS: [number, number, number][] = [
  [   0,  0, -370],
  [ -96,  8, -325],
  [  96, -6, -325],
]

const WORKER_POSITIONS: [number, number, number][] = [
  // ── Front line — API tier ────────────────────────────────────────────────
  [-260,  0,  44],   // w-0  node-api-01
  [ 260,  0,  44],   // w-1  node-api-02
  [-153,  6,   9],   // w-2  node-api-03
  [ 153,  6,   9],   // w-3  node-api-04
  // ── Second row — Orders + Payments ──────────────────────────────────────
  [-198,  0, -52],   // w-4  node-orders-01
  [ 198,  0, -52],   // w-5  node-orders-02
  [-108,  8, -44],   // w-6  node-payments-01
  [ 108,  8, -44],   // w-7  node-payments-02
  // ── Wings — Storefront ───────────────────────────────────────────────────
  [-306,  4, -18],   // w-8  node-front-01
  [ 306,  4, -18],   // w-9  node-front-02
  // ── Mid depth — Search ────────────────────────────────────────────────────
  [-162,  0, -122],  // w-10 node-search-01
  [ 162,  0, -122],  // w-11 node-search-02
  // ── Mid depth — ML/Reco ──────────────────────────────────────────────────
  [ -90,  8, -166],  // w-12 node-reco-01
  [  90,  8, -166],  // w-13 node-reco-02
  // ── Flanks — Data ─────────────────────────────────────────────────────────
  [-234,  0, -158],  // w-14 node-data-01
  [ 234,  0, -158],  // w-15 node-data-02
  // ── Deep — Messaging ─────────────────────────────────────────────────────
  [-126,  0, -228],  // w-16 node-messaging-01
  [ 126,  0, -228],  // w-17 node-messaging-02
  // ── Rear — Observability + Infra ─────────────────────────────────────────
  [   0,  6, -264],  // w-18 node-obs-01
  [   0,  0, -298],  // w-19 node-infra-01
]

// Scale the formation to cluster size — small clusters stay compact
function fleetScale(totalWorkers: number): number {
  return Math.max(0.35, Math.min(1, totalWorkers / 20))
}

function getPosition(node: ClusterNode, cpIndex: number, workerIndex: number, scale: number): [number, number, number] {
  if (node.role === 'control-plane') {
    const [x, y, z] = CP_POSITIONS[cpIndex] ?? [0, 0, -370]
    return [x * scale, y, z * scale]
  }
  const [x, y, z] = WORKER_POSITIONS[workerIndex] ?? [workerIndex * 60, 0, -100]
  return [x * scale, y, z * scale]
}

export function getNodeWorldPos(node: ClusterNode, cluster: Cluster): [number, number, number] {
  const totalWorkers = cluster.nodes.filter(n => n.role === 'worker').length
  const scale = fleetScale(totalWorkers)
  let cpIdx = 0, wIdx = 0
  for (const n of cluster.nodes) {
    const isCP = n.role === 'control-plane'
    if (n.id === node.id) return getPosition(n, cpIdx, wIdx, scale)
    if (isCP) cpIdx++; else wIdx++
  }
  return [0, 0, 0]
}

function stableFloat(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return ((h >>> 0) % 1000) / 1000
}

function deriveStatus(toNodeId: string, cluster: Cluster): Flow['status'] {
  const node = cluster.nodes.find(n => n.id === toNodeId)
  if (!node) return 'ok'
  if (!node.ready) return 'blocked'
  const hasCrash = node.pods.some(p => p.status === 'failed' || p.status === 'crashloop')
  return hasCrash ? 'degraded' : 'ok'
}

function buildFlows(cluster: Cluster, nodePositions: Record<string, [number,number,number]>): Flow[] {
  const workers = cluster.nodes.filter(n => n.role === 'worker' && nodePositions[n.id])
  if (workers.length < 2) return []

  const edges: Array<{ from: string; to: string; type: 'network' | 'data'; intensity: number }> = []

  // Ring of network flows
  for (let i = 0; i < workers.length; i++) {
    const a = workers[i].id
    const b = workers[(i + 1) % workers.length].id
    edges.push({ from: a, to: b, type: 'network', intensity: 0.40 + stableFloat(a + b, 1) * 0.55 })
  }
  // Data cross-links
  if (workers.length >= 3)
    edges.push({ from: workers[0].id, to: workers[2].id, type: 'data', intensity: 0.40 + stableFloat(workers[0].id, 2) * 0.45 })
  if (workers.length >= 4)
    edges.push({ from: workers[1].id, to: workers[3].id, type: 'data', intensity: 0.40 + stableFloat(workers[1].id, 3) * 0.40 })
  if (workers.length >= 6) {
    edges.push({ from: workers[2].id, to: workers[4].id, type: 'data', intensity: 0.35 })
    edges.push({ from: workers[0].id, to: workers[workers.length - 1].id, type: 'network', intensity: 0.30 })
  }
  if (workers.length >= 8) {
    for (let i = 0; i < Math.min(workers.length - 4, 6); i++)
      edges.push({ from: workers[i].id, to: workers[i + 4].id, type: 'data', intensity: 0.35 + stableFloat(workers[i].id, 5) * 0.30 })
  }

  return edges
    .filter(e => nodePositions[e.from] && nodePositions[e.to])
    .map(e => ({
      from:      nodePositions[e.from],
      to:        nodePositions[e.to],
      type:      e.type,
      status:    deriveStatus(e.to, cluster),
      intensity: e.intensity,
    }))
}

function ShipAnimator() {
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    for (const e of shipAnimRegistry.values()) {
      if (!e.groupRef.current) continue
      e.groupRef.current.position.y = Math.sin(t * e.drift.freq + e.drift.phase) * e.drift.amp
      e.groupRef.current.rotation.z = Math.sin(t * e.drift.tiltF + e.drift.tiltP) * e.drift.tiltA
      if (!e.nodeReady) e.groupRef.current.rotation.z += Math.sin(t * 0.8) * 0.08

      const pulse = 0.85 + Math.sin(t * 2.5 + e.posX) * 0.15
      if (e.engineRef.current)      e.engineRef.current.scale.setScalar(pulse)
      if (e.engineLightRef.current) e.engineLightRef.current.intensity = pulse * (e.isCP ? 1.0 : 0.6)
      if (e.crashRef.current && e.hasCrash)
        e.crashRef.current.material.opacity = 0.3 + Math.abs(Math.sin(t * 5)) * 0.7
    }
  })
  return null
}

interface FleetProps {
  cluster:      Cluster
  onSelectNode: (node: ClusterNode) => void
  showTraffic:  boolean
  showInbound:  boolean
  showHalos:    boolean
  showPodFlow:  boolean
  speedMult:    number
  trafficLevel: number
  health:       'good' | 'warn' | 'critical'
  focusNs:      string | null
  selectedNode: ClusterNode | null
}

export const Fleet = memo(function Fleet({ cluster, onSelectNode, showTraffic, showInbound, showHalos, showPodFlow, speedMult, trafficLevel, health, focusNs, selectedNode }: FleetProps) {
  // Node positions are static — compute once and never again
  const nodePositionsRef = useRef<Record<string, [number, number, number]> | null>(null)
  if (!nodePositionsRef.current) {
    const totalWorkers = cluster.nodes.filter(n => n.role === 'worker').length
    const scale = fleetScale(totalWorkers)
    const map: Record<string, [number, number, number]> = {}
    let cpIdx = 0, wIdx = 0
    cluster.nodes.forEach(node => {
      const isCP = node.role === 'control-plane'
      map[node.id] = getPosition(node, isCP ? cpIdx : wIdx, isCP ? cpIdx : wIdx, scale)
      if (isCP) cpIdx++; else wIdx++
    })
    nodePositionsRef.current = map
  }
  const nodePositions = nodePositionsRef.current!

  const flows = useMemo<Flow[]>(() => buildFlows(cluster, nodePositions), [nodePositions, cluster])

  const totalWorkers = cluster.nodes.filter(n => n.role === 'worker').length
  const scale = fleetScale(totalWorkers)
  let cpIdx = 0
  let wIdx  = 0

  return (
    <>
      <ShipAnimator />
      {showTraffic  && <Traffic flows={flows} speedMult={speedMult} trafficLevel={trafficLevel} />}
      {showInbound  && <NorthSouth speedMult={speedMult} trafficLevel={trafficLevel} health={health} nodePositions={nodePositions} />}
      {showPodFlow  && <PodTraffic nodePositions={nodePositions} cluster={cluster} speedMult={speedMult} trafficLevel={trafficLevel} />}
      {cluster.nodes.map(node => {
        const isCP = node.role === 'control-plane'
        const pos  = getPosition(node, isCP ? cpIdx : wIdx, isCP ? cpIdx : wIdx, scale)
        if (isCP) cpIdx++; else wIdx++
        return (
          <Suspense key={node.id} fallback={null}>
            <Ship
              node={node}
              position={pos}
              targetSize={isCP ? 20 : 14}
              nsColor={getNsColor(dominantNamespace(node.pods))}
              onClick={onSelectNode}
              showHalos={showHalos}
              dimmed={
                (focusNs !== null && !node.pods.some(p => p.namespace === focusNs)) ||
                (selectedNode !== null && node.id !== selectedNode.id)
              }
            />
          </Suspense>
        )
      })}
    </>
  )
})
