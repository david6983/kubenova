import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, Html } from '@react-three/drei'
import {
  InstancedMesh, Object3D, Color,
  MeshBasicMaterial, RingGeometry, SphereGeometry,
  Vector3, Box3, Matrix4, BufferGeometry,
} from 'three'
import type { Pod } from '../types'

const POD_COLOR: Record<Pod['status'], string> = {
  running:   '#00e87a',
  pending:   '#ffc700',
  failed:    '#ff2200',
  crashloop: '#ff5500',
}

const KIND_LABEL: Record<Pod['workloadKind'], string> = {
  deployment:  'Deploy',
  statefulset: 'STS',
  daemonset:   'DS',
  cronjob:     'CJ',
  other:       '?',
}

const POD_SIZE = 3

// Emissive color per workload kind
const KIND_EMISSIVE: Record<Pod['workloadKind'], { color: number; intensity: number }> = {
  deployment:  { color: 0x8899cc, intensity: 0.18 },
  statefulset: { color: 0xcc8822, intensity: 0.28 },
  daemonset:   { color: 0x8899cc, intensity: 0.18 },
  cronjob:     { color: 0x44cc88, intensity: 0.30 },
  other:       { color: 0x8899cc, intensity: 0.18 },
}

function applyPodGlow(mat: any, kind: Pod['workloadKind'] = 'deployment'): any {
  const { color, intensity } = KIND_EMISSIVE[kind] ?? KIND_EMISSIVE.deployment
  if ('emissive' in mat) mat.emissive = new Color(color)
  if ('emissiveIntensity' in mat) mat.emissiveIntensity = intensity
  return mat
}

interface PodItem { pod: Pod; x: number; z: number }
interface SubMesh  { geo: BufferGeometry; mat: any; localMatrix: Matrix4 }

// ── Visible pod ship instances ────────────────────────────────────────────────

function PodInstances({ items, modelPath, dimmed, kind }: { items: PodItem[]; modelPath: string; dimmed?: boolean; kind?: Pod['workloadKind'] }) {
  const { scene } = useGLTF(modelPath)
  const dummy  = useMemo(() => new Object3D(), [])
  const tmpMat = useMemo(() => new Matrix4(), [])

  const { subMeshes, scale } = useMemo(() => {
    scene.updateMatrixWorld(true)
    const box = new Box3().setFromObject(scene)
    const sz  = new Vector3()
    box.getSize(sz)
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1
    const subMeshes: SubMesh[] = []
    scene.traverse((child: any) => {
      if (!child.isMesh) return
      subMeshes.push({
        geo:         child.geometry,
        mat:         Array.isArray(child.material)
                       ? child.material.map((m: any) => applyPodGlow(m.clone(), kind))
                       : applyPodGlow(child.material.clone(), kind),
        localMatrix: child.matrixWorld.clone(),
      })
    })
    return { subMeshes, scale: POD_SIZE / maxDim }
  }, [scene, kind])

  const meshRefs = useRef<(InstancedMesh | null)[]>([])

  useEffect(() => () => {
    subMeshes.forEach(sm => {
      if (Array.isArray(sm.mat)) sm.mat.forEach((m: any) => m.dispose())
      else sm.mat.dispose()
    })
  }, [subMeshes])

  useEffect(() => {
    subMeshes.forEach(sm => {
      const mats = Array.isArray(sm.mat) ? sm.mat : [sm.mat]
      mats.forEach((m: any) => {
        m.transparent = !!dimmed
        m.opacity = dimmed ? 0.18 : 1
      })
    })
  }, [dimmed, subMeshes])

  useEffect(() => {
    if (items.length === 0) return
    items.forEach(({ x, z }, i) => {
      dummy.position.set(x, 0, z)
      dummy.scale.setScalar(scale)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      subMeshes.forEach((sm, j) => {
        const mesh = meshRefs.current[j]
        if (!mesh) return
        tmpMat.multiplyMatrices(dummy.matrix, sm.localMatrix)
        mesh.setMatrixAt(i, tmpMat)
      })
    })
    meshRefs.current.forEach(m => { if (m) m.instanceMatrix.needsUpdate = true })
  }, [items, scale, subMeshes, dummy, tmpMat])

  if (items.length === 0 || subMeshes.length === 0) return null

  return (
    <>
      {subMeshes.map((sm, j) => (
        <instancedMesh
          key={j}
          ref={el => { meshRefs.current[j] = el as InstancedMesh | null }}
          args={[sm.geo, sm.mat, items.length]}
          frustumCulled={false}
        />
      ))}
    </>
  )
}

// ── Invisible hitbox InstancedMesh for hover detection ────────────────────────
// Using a sphere covering each pod; opacity=0 so invisible but still raycasted.

const hitGeo = new SphereGeometry(POD_SIZE * 0.75, 4, 4)
const hitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

function PodHitboxes({ items, indexOffset, onHover, onUnhover, onClickThrough }: {
  items:          PodItem[]
  indexOffset:    number
  onHover:        (idx: number, pos: [number,number,number]) => void
  onUnhover:      () => void
  onClickThrough: () => void
}) {
  const meshRef = useRef<InstancedMesh>(null!)
  const dummy   = useMemo(() => new Object3D(), [])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || items.length === 0) return
    items.forEach(({ x, z }, i) => {
      dummy.position.set(x, 0, z)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [items, dummy])

  if (items.length === 0) return null
  return (
    <instancedMesh
      ref={meshRef}
      args={[hitGeo, hitMat, items.length]}
      onPointerMove={e => {
        e.stopPropagation()
        if (e.instanceId !== undefined) {
          const { x, z } = items[e.instanceId]
          onHover(e.instanceId + indexOffset, [x, POD_SIZE + 0.5, z])
          document.body.style.cursor = 'pointer'
        }
      }}
      onPointerLeave={() => {
        onUnhover()
        document.body.style.cursor = 'auto'
      }}
      onClick={e => { e.stopPropagation(); onClickThrough() }}
    />
  )
}

// ── Status halos ──────────────────────────────────────────────────────────────

function PodHalos({ items }: { items: PodItem[] }) {
  const meshRef = useRef<InstancedMesh>(null!)
  const dummy   = useMemo(() => new Object3D(), [])

  const [geo, mat] = useMemo(() => {
    const g = new RingGeometry(1.6, 2.3, 20)
    g.rotateX(-Math.PI / 2)
    return [g, new MeshBasicMaterial({ transparent: true, opacity: 0.85 })]
  }, [])

  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || items.length === 0) return
    items.forEach(({ pod, x, z }, i) => {
      dummy.position.set(x, -1.2, z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, new Color(POD_COLOR[pod.status]))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [items, dummy])

  if (items.length === 0) return null
  return <instancedMesh ref={meshRef} args={[geo, mat, items.length]} />
}

// ── Pod tooltip ───────────────────────────────────────────────────────────────

function PodTooltip({ pod, pos }: { pod: Pod; pos: [number,number,number] }) {
  const statusColor = POD_COLOR[pod.status]
  return (
    <Html distanceFactor={70} position={pos}>
      <div style={{
        background: 'rgba(0,5,20,0.92)',
        border: `1px solid ${statusColor}55`,
        borderTop: `2px solid ${statusColor}`,
        borderRadius: 4,
        padding: '5px 9px',
        color: '#c0e8ff',
        fontFamily: 'monospace',
        fontSize: 10,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        minWidth: 140,
      }}>
        <div style={{ color: '#deeeff', fontWeight: 'bold', marginBottom: 2, fontSize: 11 }}>
          {pod.name}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
          <span style={{
            background: `${statusColor}22`,
            border: `1px solid ${statusColor}66`,
            borderRadius: 2,
            color: statusColor,
            fontSize: 8,
            padding: '1px 4px',
            letterSpacing: 0.5,
          }}>
            {pod.status === 'crashloop' ? 'CRASHLOOP' : pod.status.toUpperCase()}
          </span>
          <span style={{ color: '#4a7a9a', fontSize: 8 }}>{KIND_LABEL[pod.workloadKind]}</span>
          <span style={{ color: '#4a7a9a', fontSize: 8 }}>{pod.namespace}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ color: '#5a9aba', fontSize: 9 }}>
            CPU <span style={{ color: pod.cpuPct > 0.8 ? '#ff5500' : '#deeeff' }}>{Math.round(pod.cpuPct * 100)}%</span>
          </span>
          <span style={{ color: '#5a9aba', fontSize: 9 }}>
            MEM <span style={{ color: pod.memPct > 0.85 ? '#ff2200' : '#deeeff' }}>{Math.round(pod.memPct * 100)}%</span>
          </span>
        </div>
      </div>
    </Html>
  )
}

// ── Workload grouping ─────────────────────────────────────────────────────────

// Strip the random replica suffix (-x2k, -abc, etc.) to get the workload key
function workloadKey(name: string): string {
  return name.replace(/-[a-z0-9]{1,5}$/, '')
}

function groupByWorkload(pods: Pod[]): Array<{ pods: Pod[]; kind: Pod['workloadKind'] }> {
  const map = new Map<string, { pods: Pod[]; kind: Pod['workloadKind'] }>()
  for (const pod of pods) {
    // Node-owned system pods (etcd, apiserver, etc.) have unique names that don't
    // strip cleanly — group them all under one key so they form a single pyramid.
    const key = pod.workloadKind === 'other' ? '__system__' : workloadKey(pod.name)
    if (!map.has(key)) map.set(key, { pods: [], kind: pod.workloadKind })
    map.get(key)!.pods.push(pod)
  }
  return [...map.values()].sort((a, b) => b.pods.length - a.pods.length)
}

// Delta/wedge formation: row 0 = 1 pod, row 1 = 2 pods, etc.
// cx is the column center X, startZ is the Z of the apex (top of wedge).
function deltaFormation(pods: Pod[], cx: number, startZ: number, spacing: number): PodItem[] {
  const items: PodItem[] = []
  let row = 0, added = 0
  while (added < pods.length) {
    const n = row + 1
    for (let col = 0; col < n && added < pods.length; col++) {
      items.push({
        pod: pods[added],
        x:   cx + (col - (n - 1) / 2) * spacing,
        z:   startZ - row * spacing,
      })
      added++
    }
    row++
  }
  return items
}

function deltaRows(n: number): number {
  let r = 0, total = 0
  while (total < n) { r++; total += r }
  return r
}

// ── Preload ───────────────────────────────────────────────────────────────────

useGLTF.preload('/models/Bob/Bob.gltf')
useGLTF.preload('/models/Pancake/Pancake.gltf')
useGLTF.preload('/models/Striker/Striker.gltf')
useGLTF.preload('/models/Spitfire/Spitfire.gltf')

// ── Patrol craft: CronJob pods orbit the ship in formation ────────────────────

function PatrolCraft({ pods, dimmed }: { pods: Pod[]; dimmed?: boolean }) {
  const { scene } = useGLTF('/models/Spitfire/Spitfire.gltf')
  const dummy  = useMemo(() => new Object3D(), [])
  const tmpMat = useMemo(() => new Matrix4(), [])
  const angleRef = useRef(0)

  const { subMeshes, scale } = useMemo(() => {
    scene.updateMatrixWorld(true)
    const box = new Box3().setFromObject(scene)
    const sz  = new Vector3()
    box.getSize(sz)
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1
    const subMeshes: SubMesh[] = []
    scene.traverse((child: any) => {
      if (!child.isMesh) return
      subMeshes.push({
        geo:         child.geometry,
        mat:         Array.isArray(child.material)
                       ? child.material.map((m: any) => applyPodGlow(m.clone(), 'cronjob'))
                       : applyPodGlow(child.material.clone(), 'cronjob'),
        localMatrix: child.matrixWorld.clone(),
      })
    })
    return { subMeshes, scale: POD_SIZE / maxDim }
  }, [scene])

  const meshRefs = useRef<(InstancedMesh | null)[]>([])

  useEffect(() => () => {
    subMeshes.forEach(sm => {
      if (Array.isArray(sm.mat)) sm.mat.forEach((m: any) => m.dispose())
      else sm.mat.dispose()
    })
  }, [subMeshes])

  useEffect(() => {
    subMeshes.forEach(sm => {
      const mats = Array.isArray(sm.mat) ? sm.mat : [sm.mat]
      mats.forEach((m: any) => {
        m.transparent = !!dimmed
        m.opacity = dimmed ? 0.18 : 1
      })
    })
  }, [dimmed, subMeshes])

  useFrame((_, delta) => {
    if (pods.length === 0 || subMeshes.length === 0) return
    angleRef.current += delta * 0.22 // slow patrol orbit
    pods.forEach((_, i) => {
      const a = angleRef.current + (i * Math.PI * 2 / pods.length)
      const r = 55 + i * 14
      dummy.position.set(Math.cos(a) * r, 18, Math.sin(a) * r)
      dummy.rotation.y = -a + Math.PI / 2
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      subMeshes.forEach((sm, j) => {
        const mesh = meshRefs.current[j]
        if (!mesh) return
        tmpMat.multiplyMatrices(dummy.matrix, sm.localMatrix)
        mesh.setMatrixAt(i, tmpMat)
      })
    })
    meshRefs.current.forEach(m => { if (m) m.instanceMatrix.needsUpdate = true })
  })

  if (pods.length === 0 || subMeshes.length === 0) return null

  return (
    <>
      {subMeshes.map((sm, j) => (
        <instancedMesh
          key={j}
          ref={el => { meshRefs.current[j] = el as InstancedMesh | null }}
          args={[sm.geo, sm.mat, pods.length]}
          frustumCulled={false}
        />
      ))}
    </>
  )
}

// ── Public component ─────────────────────────────────────────────────────────

export function PodRing({ pods, isCP, showHalos, dimmed, onClickThrough }: { pods: Pod[]; isCP: boolean; showHalos?: boolean; dimmed?: boolean; onClickThrough?: () => void }) {
  const [hovered, setHovered] = useState<{ pod: Pod; pos: [number,number,number] } | null>(null)

  const { deployItems, stsItems, dsItems, cjPods, allItems } = useMemo(() => {
    const squadronPods = pods.filter(p => p.workloadKind !== 'cronjob')
    const cjPods       = pods.filter(p => p.workloadKind === 'cronjob')

    const podSpacing = Math.max(10, 8 + Math.pow(squadronPods.length, 0.38))
    const groupGap   = podSpacing * 2.8
    const colX       = Math.max(30, 22 + Math.pow(squadronPods.length, 0.45)) * (isCP ? 1.3 : 1.0)
    const startZ     = colX * 1.2

    const groups = groupByWorkload(squadronPods)

    const leftGroups  = groups.filter((_, i) => i % 2 === 0)
    const rightGroups = groups.filter((_, i) => i % 2 === 1)

    const allItems: PodItem[] = []

    const layoutColumn = (colGroups: typeof groups, x: number) => {
      let z = startZ
      for (const g of colGroups) {
        allItems.push(...deltaFormation(g.pods, x, z, podSpacing))
        z -= deltaRows(g.pods.length) * podSpacing + groupGap
      }
    }

    layoutColumn(leftGroups,  -colX)
    layoutColumn(rightGroups, +colX)

    const deployItems = allItems.filter(i => i.pod.workloadKind === 'deployment' || i.pod.workloadKind === 'other')
    const stsItems    = allItems.filter(i => i.pod.workloadKind === 'statefulset')
    const dsItems     = allItems.filter(i => i.pod.workloadKind === 'daemonset')

    return { deployItems, stsItems, dsItems, cjPods, allItems }
  }, [pods, isCP])

  const handleHover = (idx: number, pos: [number,number,number]) => {
    const item = allItems[idx]
    if (item) setHovered({ pod: item.pod, pos })
  }
  const handleUnhover = () => setHovered(null)

  return (
    <>
      <PodInstances items={deployItems} modelPath="/models/Bob/Bob.gltf"         dimmed={dimmed} kind="deployment" />
      <PodInstances items={stsItems}   modelPath="/models/Pancake/Pancake.gltf"  dimmed={dimmed} kind="statefulset" />
      <PodInstances items={dsItems}    modelPath="/models/Striker/Striker.gltf"  dimmed={dimmed} kind="daemonset" />
      <PatrolCraft pods={cjPods} dimmed={dimmed} />
      {showHalos !== false && !dimmed && <PodHalos items={allItems} />}

      <PodHitboxes items={deployItems} indexOffset={0}                                  onHover={handleHover} onUnhover={handleUnhover} onClickThrough={onClickThrough ?? (() => {})} />
      <PodHitboxes items={stsItems}    indexOffset={deployItems.length}                 onHover={handleHover} onUnhover={handleUnhover} onClickThrough={onClickThrough ?? (() => {})} />
      <PodHitboxes items={dsItems}     indexOffset={deployItems.length + stsItems.length} onHover={handleHover} onUnhover={handleUnhover} onClickThrough={onClickThrough ?? (() => {})} />

      {hovered && <PodTooltip pod={hovered.pod} pos={hovered.pos} />}
    </>
  )
}
