import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { MeshBasicMaterial, Box3, Vector3 } from 'three'
import type { ClusterNode } from '../types'
import { PodRing } from './PodRing'

// ── same model list as Ship.tsx ───────────────────────────────────────────────

const WORKER_MODELS = [
  '/models/Challenger/Challenger.gltf',
  '/models/Executioner/Executioner.gltf',
  '/models/Omen/Omen.gltf',
  '/models/Insurgent/Insurgent.gltf',
  '/models/Spitfire/Spitfire.gltf',
  '/models/Zenith/Zenith.gltf',
  '/models/Dispatcher/Dispatcher.gltf',
]

function getModelUrl(node: ClusterNode): string {
  if (node.role === 'control-plane') return '/models/Imperial/Imperial.gltf'
  const idx = parseInt(node.id.replace(/\D/g, '')) || 0
  return WORKER_MODELS[idx % WORKER_MODELS.length]
}

const TARGET_SIZE = 24
const SHIP_X = 38     // wireframe node — right side
const PODS_X = -40    // pod squadrons — left side

// ── wireframe ship (no clip, full hull) ───────────────────────────────────────

function WireframeShip({ node }: { node: ClusterNode }) {
  const { scene } = useGLTF(getModelUrl(node))

  const cloned = useMemo(() => {
    const clone = scene.clone(true)
    clone.position.set(0, 0, 0)
    clone.scale.set(1, 1, 1)
    clone.rotation.set(0, 0, 0)
    clone.updateMatrixWorld(true)

    const box = new Box3().setFromObject(clone)
    const sz  = new Vector3()
    box.getSize(sz)
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1
    clone.scale.setScalar(TARGET_SIZE / maxDim)
    clone.updateMatrixWorld(true)

    const box2   = new Box3().setFromObject(clone)
    const center = new Vector3()
    box2.getCenter(center)
    clone.position.sub(center)

    clone.traverse((child: any) => {
      if (!child.isMesh) return
      child.material = new MeshBasicMaterial({
        color: '#1a5ecc',
        wireframe: true,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      })
    })

    return clone
  }, [scene])

  return <primitive object={cloned} />
}

// ── camera animator ───────────────────────────────────────────────────────────

const _fleet_pos = new Vector3(0, 560, -750)
const _fleet_tgt = new Vector3(0, 0, 0)
// look at the midpoint between ship and pods, slightly above
const _int_pos   = new Vector3(-5, 110, 130)
const _int_tgt   = new Vector3(-5, 0, 0)

export function CameraAnimator({
  interiorNode,
  controlsRef,
}: {
  interiorNode: ClusterNode | null
  controlsRef:  React.RefObject<any>
}) {
  const { camera } = useThree()
  const tgtPos    = useRef(new Vector3(0, 560, -750))
  const tgtLook   = useRef(new Vector3(0, 0, 0))
  const prevInter = useRef(false)
  const animating = useRef(false)

  useFrame(() => {
    const isInter  = !!interiorNode
    const entering = isInter && !prevInter.current
    const leaving  = !isInter && prevInter.current

    if (entering) {
      camera.position.set(-5, 250, 300)
      if (controlsRef.current) controlsRef.current.target.copy(_int_tgt)
      tgtPos.current.copy(_int_pos)
      tgtLook.current.copy(_int_tgt)
      animating.current = true
    } else if (leaving) {
      tgtPos.current.copy(_fleet_pos)
      tgtLook.current.copy(_fleet_tgt)
      animating.current = true
    }
    prevInter.current = isInter

    if (!animating.current) return

    camera.position.lerp(tgtPos.current, 0.05)
    if (controlsRef.current) {
      controlsRef.current.target.lerp(tgtLook.current, 0.05)
      controlsRef.current.update()
    }

    const distPos  = camera.position.distanceTo(tgtPos.current)
    const distLook = controlsRef.current
      ? controlsRef.current.target.distanceTo(tgtLook.current)
      : 0
    if (distPos < 0.5 && distLook < 0.5) animating.current = false
  })

  return null
}

// ── main export ───────────────────────────────────────────────────────────────

export function InteriorScene({ node }: { node: ClusterNode }) {
  return (
    <>
      <ambientLight intensity={0.4} color="#2255aa" />
      {/* light on the ship side */}
      <pointLight position={[SHIP_X, 25,  0]} intensity={2.2} color="#3366cc" distance={100} />
      {/* light on the pod side */}
      <pointLight position={[PODS_X, 18,  8]} intensity={1.8} color="#224466" distance={140} />
      {/* fill from below */}
      <pointLight position={[0,     -12,  0]} intensity={0.5} color="#112244" distance={250} />

      {/* Right: wireframe hull */}
      <group position={[SHIP_X, 0, 0]}>
        <WireframeShip node={node} />
      </group>

      {/* Left: pod squadrons — same formations as fleet view */}
      <group position={[PODS_X, 0, 0]}>
        <PodRing
          pods={node.pods}
          isCP={node.role === 'control-plane'}
          showHalos
          onClickThrough={() => {}}
        />
      </group>
    </>
  )
}
