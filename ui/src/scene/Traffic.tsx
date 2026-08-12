import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3, Vector3, BufferGeometry, LineBasicMaterial,
  Line as ThreeLine, InstancedMesh, Object3D, Color,
  SphereGeometry, MeshBasicMaterial,
} from 'three'

export type FlowType   = 'network' | 'data'
export type FlowStatus = 'ok' | 'degraded' | 'blocked'

export interface Flow {
  from:      [number, number, number]
  to:        [number, number, number]
  type:      FlowType
  status:    FlowStatus
  intensity: number
}

const TYPE_COLOR: Record<FlowType, string> = {
  network: '#00b4ff',
  data:    '#00e87a',
}
const STATUS_COLOR: Record<FlowStatus, string> = {
  ok:       '',
  degraded: '#ffc700',
  blocked:  '#ff2200',
}
function flowColor(flow: Flow): string {
  return flow.status === 'ok' ? TYPE_COLOR[flow.type] : STATUS_COLOR[flow.status]
}

// ── Static lines (one per flow) ───────────────────────────────────────────────

function FlowLines({ flows, curves }: { flows: Flow[]; curves: CatmullRomCurve3[] }) {
  const lineObjs = useMemo(() =>
    flows.map((flow, i) => {
      const color = flowColor(flow)
      const pts = flow.status === 'blocked'
        ? curves[i].getPoints(48).slice(0, 30)
        : curves[i].getPoints(48)
      const geo = new BufferGeometry().setFromPoints(pts)
      const opacity = flow.status === 'blocked' ? 0.30 : flow.status === 'degraded' ? 0.18 : 0.13
      const mat = new LineBasicMaterial({ color, transparent: true, opacity })
      return new ThreeLine(geo, mat)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flows],
  )

  useEffect(() => () => {
    lineObjs.forEach(l => { l.geometry.dispose(); (l.material as LineBasicMaterial).dispose() })
  }, [lineObjs])

  return <>{lineObjs.map((l, i) => <primitive key={i} object={l} />)}</>
}

// ── All particles in one InstancedMesh — one useFrame total ──────────────────

interface ParticleEntry {
  curve:  CatmullRomCurve3
  color:  Color
  speed:  number
  cutoff: number  // 0.6 for blocked, 1.0 otherwise
  offset: number  // start phase
}

const PMAX = 5

function TrafficParticles({ flows, curves, speedMult, trafficLevel }: {
  flows: Flow[]; curves: CatmullRomCurve3[]; speedMult: number; trafficLevel: number
}) {
  const meshRef    = useRef<InstancedMesh>(null!)
  const dummy      = useMemo(() => new Object3D(), [])
  const prevActiveP = useRef(PMAX)
  const total      = flows.length * PMAX

  const base = useMemo(() => flows.map((flow, fi) => ({
    curve:  curves[fi],
    color:  new Color(flowColor(flow)),
    speed:  flow.status === 'degraded' ? 0.03 + flow.intensity * 0.05 : 0.05 + flow.intensity * 0.10,
    cutoff: flow.status === 'blocked' ? 0.60 : 1.0,
  })), [flows, curves])

  const progress = useRef(new Float32Array(0))
  useEffect(() => {
    const arr = new Float32Array(total)
    flows.forEach((_, fi) => {
      for (let p = 0; p < PMAX; p++) arr[fi * PMAX + p] = p / PMAX
    })
    progress.current = arr
  }, [flows, total])

  const [geo, mat] = useMemo(() => [
    new SphereGeometry(0.65, 4, 4),
    new MeshBasicMaterial({ transparent: true, opacity: 0.9 }),
  ], [])
  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])

  // Set colors once — they never change per flow
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    base.forEach((e, fi) => {
      for (let p = 0; p < PMAX; p++) mesh.setColorAt(fi * PMAX + p, e.color)
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [base])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || base.length === 0) return
    const activeP   = Math.max(2, Math.round(2 + trafficLevel * (PMAX - 2)))
    const partScale = 0.5 + trafficLevel * 1.2
    const prev      = prevActiveP.current
    let dirty = false

    base.forEach((e, fi) => {
      for (let p = 0; p < PMAX; p++) {
        const idx = fi * PMAX + p
        if (p >= activeP) {
          if (p < prev) {          // newly hidden — set once
            dummy.scale.setScalar(0.001)
            dummy.updateMatrix()
            mesh.setMatrixAt(idx, dummy.matrix)
            dirty = true
          }
          continue
        }
        const t = (progress.current[idx] + e.speed * speedMult * delta) % 1
        progress.current[idx] = t
        dummy.position.copy(e.curve.getPoint(t > e.cutoff ? 0 : t))
        dummy.scale.setScalar(t > e.cutoff ? 0.001 : partScale)
        dummy.updateMatrix()
        mesh.setMatrixAt(idx, dummy.matrix)
        dirty = true
      }
    })
    prevActiveP.current = activeP
    if (dirty) mesh.instanceMatrix.needsUpdate = true
  })

  if (total === 0) return null
  return <instancedMesh ref={meshRef} args={[geo, mat, total]} />
}

// ── Public ────────────────────────────────────────────────────────────────────

export function Traffic({ flows, speedMult = 1, trafficLevel = 0.5 }: { flows: Flow[]; speedMult?: number; trafficLevel?: number }) {
  const curves = useMemo(() =>
    flows.map(flow => {
      const a   = new Vector3(...flow.from).setY(-1)
      const b   = new Vector3(...flow.to).setY(-1)
      const mid = a.clone().lerp(b, 0.5)
      mid.y += a.distanceTo(b) * 0.05
      return new CatmullRomCurve3([a, mid, b])
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flows],
  )

  return (
    <>
      <FlowLines flows={flows} curves={curves} />
      <TrafficParticles flows={flows} curves={curves} speedMult={speedMult} trafficLevel={trafficLevel} />
    </>
  )
}
