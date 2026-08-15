import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3, Vector3, BufferGeometry, LineBasicMaterial,
  Line as ThreeLine, InstancedMesh, Object3D, Color,
  SphereGeometry, MeshBasicMaterial,
} from 'three'
import type { Cluster } from '../types'

// Mirror PodRing's colX / startZ formula so flow lines land on the actual pyramids
function podFormationPos(
  nodePos: [number, number, number],
  isCP: boolean,
  podCount: number,
  column: 'left' | 'right',
): Vector3 {
  const colX   = Math.max(30, 22 + Math.pow(Math.max(1, podCount), 0.45)) * (isCP ? 1.3 : 1.0)
  const startZ = colX * 1.2
  const x = column === 'left' ? -colX : colX
  return new Vector3(nodePos[0] + x, nodePos[1] - 1, nodePos[2] + startZ * 0.5)
}

function stableFloat(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return ((h >>> 0) % 1000) / 1000
}

function buildSvcGraph(
  nodePositions: Record<string, [number,number,number]>,
  cpSet: Set<string>,
): Array<{ from: string; to: string; kind: 'network' | 'data'; intensity: number }> {
  const workerIds = Object.keys(nodePositions).filter(id => !cpSet.has(id))
  if (workerIds.length < 2) return []

  const edges: Array<{ from: string; to: string; kind: 'network' | 'data'; intensity: number }> = []

  // Ring
  for (let i = 0; i < workerIds.length; i++) {
    const a = workerIds[i]
    const b = workerIds[(i + 1) % workerIds.length]
    edges.push({ from: a, to: b, kind: 'network', intensity: 0.40 + stableFloat(a + b, 1) * 0.55 })
  }
  // Data cross-links
  if (workerIds.length >= 3)
    edges.push({ from: workerIds[0], to: workerIds[2], kind: 'data', intensity: 0.55 + stableFloat(workerIds[0], 2) * 0.30 })
  if (workerIds.length >= 4)
    edges.push({ from: workerIds[1], to: workerIds[3], kind: 'data', intensity: 0.50 + stableFloat(workerIds[1], 3) * 0.30 })
  if (workerIds.length >= 6) {
    for (let i = 0; i < Math.floor(workerIds.length / 2) - 1; i++)
      edges.push({ from: workerIds[i], to: workerIds[i + Math.ceil(workerIds.length / 2)], kind: 'data', intensity: 0.30 + stableFloat(workerIds[i], 4) * 0.25 })
  }

  return edges
}

const COLOR = { network: '#00aaff', data: '#cc66ff' }

interface ComputedEdge {
  curve:     CatmullRomCurve3
  color:     Color
  intensity: number
}

interface Props {
  nodePositions: Record<string, [number,number,number]>
  cluster:       Cluster
  speedMult?:    number
  trafficLevel?: number
}

export function PodTraffic({ nodePositions, cluster, speedMult = 1, trafficLevel = 0.5 }: Props) {
  const cpSet = useMemo(() => {
    const s = new Set<string>()
    cluster.nodes.forEach(n => { if (n.role === 'control-plane') s.add(n.id) })
    return s
  }, [cluster])

  const nodeMap = useMemo(
    () => new Map(cluster.nodes.map(n => [n.id, n])),
    [cluster],
  )

  // Real flow intensity per node-pair (from eBPF), keyed as sorted "nodeA↔nodeB"
  const realIntensity = useMemo(() => {
    if (!cluster.flows?.length) return new Map<string, number>()
    const byteMap = new Map<string, number>()
    for (const flow of cluster.flows) {
      for (const srcNode of cluster.nodes) {
        const srcMatch = srcNode.pods.some(p => p.name === flow.srcPod || p.name.startsWith(flow.srcPod + '-'))
        if (!srcMatch) continue
        for (const dstNode of cluster.nodes) {
          if (dstNode.id === srcNode.id) continue
          const dstMatch = dstNode.pods.some(p => p.name === flow.dstPod || p.name.startsWith(flow.dstPod + '-'))
          if (!dstMatch) continue
          const key = [srcNode.id, dstNode.id].sort().join('↔')
          byteMap.set(key, (byteMap.get(key) ?? 0) + (flow.bytesPerSec ?? 0) + (flow.packets ?? 0) * 10)
        }
      }
    }
    const max = Math.max(...byteMap.values(), 1)
    const result = new Map<string, number>()
    byteMap.forEach((v, k) => result.set(k, 0.30 + (v / max) * 0.70))
    return result
  }, [cluster])

  const edges = useMemo<ComputedEdge[]>(() => {
    const svcGraph = buildSvcGraph(nodePositions, cpSet)
    return svcGraph.flatMap(e => {
      const fp = nodePositions[e.from]; const tp = nodePositions[e.to]
      if (!fp || !tp) return []
      const fromPods = nodeMap.get(e.from)?.pods.filter(p => p.workloadKind !== 'cronjob').length ?? 5
      const toPods   = nodeMap.get(e.to)?.pods.filter(p => p.workloadKind !== 'cronjob').length ?? 5
      // network flows: left column (deployments) → left; data flows: left → right (statefulsets)
      const srcCol: 'left' | 'right' = 'left'
      const dstCol: 'left' | 'right' = e.kind === 'data' ? 'right' : 'left'
      const src = podFormationPos(fp, cpSet.has(e.from), fromPods, srcCol)
      const dst = podFormationPos(tp, cpSet.has(e.to),   toPods,   dstCol)
      const mid = src.clone().lerp(dst, 0.5)
      mid.y += src.distanceTo(dst) * 0.04
      const realKey = [e.from, e.to].sort().join('↔')
      const intensity = realIntensity.get(realKey) ?? e.intensity
      return [{ curve: new CatmullRomCurve3([src, mid, dst]), color: new Color(COLOR[e.kind]), intensity }]
    })
  }, [nodePositions, cpSet, nodeMap, realIntensity])

  // ── Static lines ─────────────────────────────────────────────────────────────
  const lineObjs = useMemo(() =>
    edges.map(e => {
      const geo = new BufferGeometry().setFromPoints(e.curve.getPoints(48))
      const mat = new LineBasicMaterial({ color: e.color, transparent: true, opacity: 0.12 })
      return new ThreeLine(geo, mat)
    }),
    [edges],
  )
  useEffect(() => () => {
    lineObjs.forEach(l => { l.geometry.dispose(); (l.material as LineBasicMaterial).dispose() })
  }, [lineObjs])

  // ── Particles — pre-allocate PMAX slots, active count scales with trafficLevel
  const PMAX       = 5
  const total      = edges.length * PMAX
  const meshRef    = useRef<InstancedMesh>(null!)
  const dummy      = useMemo(() => new Object3D(), [])
  const prevActiveP = useRef(PMAX)
  const progress   = useRef(new Float32Array(0))

  useEffect(() => {
    const arr = new Float32Array(total)
    edges.forEach((_, ei) => {
      for (let p = 0; p < PMAX; p++) arr[ei * PMAX + p] = p / PMAX
    })
    progress.current = arr
  }, [edges, total])

  const [geo, mat] = useMemo(() => [
    new SphereGeometry(0.6, 4, 4),
    new MeshBasicMaterial({ transparent: true, opacity: 0.88 }),
  ], [])
  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])

  // Set colors once — they never change per edge
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    edges.forEach((e, ei) => {
      for (let p = 0; p < PMAX; p++) mesh.setColorAt(ei * PMAX + p, e.color)
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [edges])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || edges.length === 0) return
    const activeP   = Math.max(1, Math.round(1 + trafficLevel * (PMAX - 1)))
    const partScale = 0.5 + trafficLevel * 1.2
    const prev      = prevActiveP.current
    let dirty = false

    edges.forEach((e, ei) => {
      const speed = (0.04 + e.intensity * 0.09) * speedMult
      for (let p = 0; p < PMAX; p++) {
        const idx = ei * PMAX + p
        if (p >= activeP) {
          if (p < prev) {           // newly hidden — set once
            dummy.scale.setScalar(0.001)
            dummy.updateMatrix()
            mesh.setMatrixAt(idx, dummy.matrix)
            dirty = true
          }
          continue
        }
        const t = (progress.current[idx] + speed * delta) % 1
        progress.current[idx] = t
        dummy.position.copy(e.curve.getPoint(t))
        dummy.scale.setScalar(partScale)
        dummy.updateMatrix()
        mesh.setMatrixAt(idx, dummy.matrix)
        dirty = true
      }
    })
    prevActiveP.current = activeP
    if (dirty) mesh.instanceMatrix.needsUpdate = true
  })

  if (edges.length === 0) return null
  return (
    <>
      {lineObjs.map((l, i) => <primitive key={i} object={l} />)}
      {total > 0 && <instancedMesh ref={meshRef} args={[geo, mat, total]} />}
    </>
  )
}
