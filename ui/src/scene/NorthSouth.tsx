import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedMesh, Object3D, MeshBasicMaterial, BoxGeometry, Color } from 'three'
import type { ClusterHealth } from './Weather'

const COUNT_MAX   = 40
const COUNT_MIN   = 4
const SPAWN_Z_MIN = 550
const SPAWN_Z_MAX = 950

const C_2XX = new Color('#44ff88')
const C_4XX = new Color('#ffaa22')
const C_5XX = new Color('#ff3333')
const COLORS = [C_2XX, C_4XX, C_5XX]

interface Proj {
  sx: number; sy: number; sz: number
  tx: number; ty: number; tz: number
  progress: number
  speed: number
  colorIdx: 0 | 1 | 2
}

type Target = { pos: [number, number, number]; weight: number }

function pickColorIdx(trafficLevel: number, health: ClusterHealth): 0 | 1 | 2 {
  const p4xx = 0.02 + trafficLevel * 0.10 + (health === 'warn' ? 0.08 : 0) + (health === 'critical' ? 0.15 : 0)
  const p5xx = 0.005 + trafficLevel * 0.04 + (health === 'warn' ? 0.06 : 0) + (health === 'critical' ? 0.18 : 0)
  const r = Math.random()
  if (r < p5xx) return 2
  if (r < p5xx + p4xx) return 1
  return 0
}

function deriveTargets(nodePositions: Record<string, [number,number,number]>): Target[] {
  const positions = Object.values(nodePositions)
  if (positions.length === 0) return [{ pos: [0, 0, 0], weight: 1 }]
  // Sort front-to-back: nodes with larger z are closer to inbound direction
  const sorted = [...positions].sort((a, b) => b[2] - a[2])
  const total = sorted.length
  // Front nodes get more traffic weight
  return sorted.map((pos, i) => ({
    pos: pos as [number, number, number],
    weight: (total - i) / ((total * (total + 1)) / 2),
  }))
}

export function NorthSouth({
  speedMult    = 1,
  trafficLevel = 0.5,
  health       = 'good',
  nodePositions,
}: {
  speedMult?:    number
  trafficLevel?: number
  health?:       ClusterHealth
  nodePositions?: Record<string, [number,number,number]>
}) {
  const targetsRef  = useRef<Target[]>([{ pos: [0, 0, 0], weight: 1 }])
  const meshRef     = useRef<InstancedMesh>(null!)
  const dummy       = useMemo(() => new Object3D(), [])
  const prevActive  = useRef(0)
  const initialized = useRef(false)

  function pickTarget(): [number, number, number] {
    const targets = targetsRef.current
    const r = Math.random()
    let acc = 0
    for (const t of targets) {
      acc += t.weight
      if (r < acc) return t.pos
    }
    return targets[0].pos
  }

  function spawnProj(tl: number, h: ClusterHealth): Proj {
    const [tx, ty, tz] = pickTarget()
    return {
      sx: (Math.random() - 0.5) * 600,
      sy: (Math.random() - 0.5) * 80,
      sz: SPAWN_Z_MIN + Math.random() * (SPAWN_Z_MAX - SPAWN_Z_MIN),
      tx, ty, tz,
      progress: Math.random(),
      speed: 0.18 + Math.random() * 0.18,
      colorIdx: pickColorIdx(tl, h),
    }
  }

  const projs = useRef<Proj[]>(Array.from({ length: COUNT_MAX }, () => ({
    sx: 0, sy: 0, sz: SPAWN_Z_MIN,
    tx: 0, ty: 0, tz: 0,
    progress: 1, // force immediate respawn on first frame
    speed: 0.18 + Math.random() * 0.18,
    colorIdx: 0 as const,
  })))

  // Update targets whenever real node positions arrive
  useEffect(() => {
    if (!nodePositions || Object.keys(nodePositions).length === 0) return
    targetsRef.current = deriveTargets(nodePositions)
    // Force all active projectiles to respawn with new targets
    projs.current.forEach(p => { p.progress = 1.0 })
  }, [nodePositions])

  const [geo, mat] = useMemo(() => [
    new BoxGeometry(0.6, 0.6, 3.5),
    new MeshBasicMaterial({ color: '#ffffff' }),
  ], [])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    // On first frame: hide ALL instances and set colors, then let active ones animate
    if (!initialized.current) {
      dummy.scale.setScalar(0.001)
      dummy.updateMatrix()
      for (let i = 0; i < COUNT_MAX; i++) {
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, COLORS[projs.current[i].colorIdx])
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      initialized.current = true
    }

    const active    = Math.round(COUNT_MIN + trafficLevel * (COUNT_MAX - COUNT_MIN))
    const projScale = 0.6 + trafficLevel * 1.4
    const prev      = prevActive.current
    let dirtyMatrix = false
    let dirtyColor  = false

    for (let i = 0; i < Math.max(active, prev); i++) {
      if (i >= active) {
        if (i < prev) {
          dummy.scale.setScalar(0.001)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
          dirtyMatrix = true
        }
        continue
      }

      const p = projs.current[i]
      p.progress += p.speed * speedMult * delta

      if (p.progress >= 1) {
        const next = spawnProj(trafficLevel, health)
        next.progress = 0
        projs.current[i] = next
        mesh.setColorAt(i, COLORS[next.colorIdx])
        dirtyColor = true
      }

      const t    = p.progress
      const fade = t < 0.06 ? t / 0.06 : t > 0.88 ? (1 - t) / 0.12 : 1
      dummy.position.set(
        p.sx + (p.tx - p.sx) * t,
        p.sy + (p.ty - p.sy) * t,
        p.sz + (p.tz - p.sz) * t,
      )
      dummy.scale.setScalar(fade * projScale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      dirtyMatrix = true
    }

    prevActive.current = active
    if (dirtyMatrix) mesh.instanceMatrix.needsUpdate = true
    if (dirtyColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={meshRef} args={[geo, mat, COUNT_MAX]} />
}
