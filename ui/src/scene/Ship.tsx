import { useEffect, useRef, useState, useMemo, memo } from 'react'
import { useGLTF, Html } from '@react-three/drei'
import { Box3, Vector3, MeshStandardMaterial, Color, Group } from 'three'
import type { ClusterNode } from '../types'
import { PodRing } from './PodRing'

// ── Animation registry (shared with ShipAnimator in Fleet) ───────────────────

export type DriftParams = {
  freq: number; amp: number; phase: number
  tiltF: number; tiltA: number; tiltP: number
}
export type ShipAnimEntry = {
  groupRef:       React.RefObject<Group | null>
  engineRef:      React.RefObject<any>
  engineLightRef: React.RefObject<any>
  crashRef:       React.RefObject<any>
  drift:          DriftParams
  posX:           number
  nodeReady:      boolean
  hasCrash:       boolean
  isCP:           boolean
}
export const shipAnimRegistry = new Map<string, ShipAnimEntry>()

interface ShipProps {
  node: ClusterNode
  position: [number, number, number]
  targetSize?: number
  nsColor?: string
  onClick?: (node: ClusterNode) => void
  showHalos?: boolean
  dimmed?: boolean
}

const WORKER_MODELS = [
  '/models/Challenger/Challenger.gltf',
  '/models/Executioner/Executioner.gltf',
  '/models/Omen/Omen.gltf',
  '/models/Insurgent/Insurgent.gltf',
  '/models/Spitfire/Spitfire.gltf',
  '/models/Zenith/Zenith.gltf',
  '/models/Dispatcher/Dispatcher.gltf',
]

// Preload all models so they're ready before ships render
useGLTF.preload('/models/Imperial/Imperial.gltf')
WORKER_MODELS.forEach(url => useGLTF.preload(url))

function getModelUrl(node: ClusterNode, workerIdx: number): string {
  if (node.role === 'control-plane') return '/models/Imperial/Imperial.gltf'
  return WORKER_MODELS[workerIdx % WORKER_MODELS.length]
}

function nodeHealth(node: ClusterNode): 'good' | 'warn' | 'critical' {
  if (!node.ready) return 'critical'
  const hasFailed = node.pods.some(p => p.status === 'failed' || p.status === 'crashloop')
  if (hasFailed || node.cpuPct > 0.8 || node.memPct > 0.85) return 'warn'
  return 'good'
}

const HEALTH_EMISSIVE = { good: '#0a1240', warn: '#993300', critical: '#660000' }
const HEALTH_INTENSITY = { good: 0.15, warn: 0.8, critical: 0.9 }

export const Ship = memo(function Ship({ node, position, targetSize = 16, nsColor = '#4466ff', onClick, showHalos = true, dimmed = false }: ShipProps) {
  const workerIdx = parseInt(node.id.replace(/\D/g, '')) || 0
  const url = getModelUrl(node, workerIdx)
  const { scene } = useGLTF(url)
  const groupRef = useRef<Group>(null!)
  const engineRef = useRef<any>(null!)
  const engineLightRef = useRef<any>(null!)
  const crashRef = useRef<any>(null!)
  const hasCrash = node.pods.some(p => p.status === 'crashloop' || p.status === 'failed')
  const [hovered, setHovered] = useState(false)
  const health = nodeHealth(node)

  // Clone, normalize size/position, apply materials — all in useMemo so the
  // ship is correctly positioned on the very first render (no useEffect delay).
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)

    // Reset transforms before measuring
    clone.position.set(0, 0, 0)
    clone.scale.set(1, 1, 1)
    clone.rotation.set(0, 0, 0)
    clone.updateMatrixWorld(true)

    // Normalize to targetSize
    const box = new Box3().setFromObject(clone)
    const size = new Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)
    if (maxDim > 0) {
      const finalSize = node.role === 'control-plane' ? targetSize * 2 : targetSize
      clone.scale.setScalar(finalSize / maxDim)
      clone.updateMatrixWorld(true)
      const box2 = new Box3().setFromObject(clone)
      const center = new Vector3()
      box2.getCenter(center)
      clone.position.sub(center)
    }

    // Clone materials + apply health emissive
    clone.traverse((child: any) => {
      if (!child.isMesh || !child.material) return
      const mats = Array.isArray(child.material)
        ? child.material.map((m: MeshStandardMaterial) => m.clone())
        : [child.material.clone()]
      mats.forEach((mat: MeshStandardMaterial) => {
        mat.emissive = new Color(HEALTH_EMISSIVE[health])
        mat.emissiveIntensity = HEALTH_INTENSITY[health]
      })
      child.material = Array.isArray(child.material) ? mats : mats[0]
    })

    return clone
  }, [scene, node.role, targetSize, health])

  // Unique random drift per ship — seeded from node id so stable across renders
  const drift = useMemo(() => {
    const seed = node.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    const r = (n: number) => (Math.sin(seed * 127.1 + n * 311.7) * 0.5 + 0.5)
    return {
      freq:  0.18 + r(0) * 0.22,      // 0.18–0.40 Hz
      amp:   0.6  + r(1) * 1.2,       // 0.6–1.8 units
      phase: r(2) * Math.PI * 2,      // random start phase
      tiltF: 0.12 + r(3) * 0.15,     // roll frequency
      tiltA: 0.02 + r(4) * 0.03,     // roll amplitude
      tiltP: r(5) * Math.PI * 2,
    }
  }, [node.id])

  // Dim materials when not in focused namespace
  useEffect(() => {
    clonedScene.traverse((child: any) => {
      if (!child.isMesh || !child.material) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((mat: any) => {
        mat.transparent = dimmed
        mat.opacity = dimmed ? 0.18 : 1
        mat.emissiveIntensity = dimmed ? 0 : HEALTH_INTENSITY[health]
      })
    })
  }, [dimmed, clonedScene, health])

  // Register this ship's refs in the module-level registry.
  // ShipAnimator in Fleet drives all ships in a single useFrame.
  useEffect(() => {
    shipAnimRegistry.set(node.id, {
      groupRef, engineRef, engineLightRef, crashRef,
      drift, posX: position[0],
      nodeReady: node.ready, hasCrash,
      isCP: node.role === 'control-plane',
    })
    return () => { shipAnimRegistry.delete(node.id) }
  }, [node.id, node.ready, hasCrash, drift, position, groupRef, engineRef, engineLightRef, crashRef])

  const ringColor = health === 'good' ? '#00ccff' : health === 'warn' ? '#ffaa00' : '#ff2200'

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={() => onClick?.(node)}
      onPointerEnter={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'auto' }}
    >
      <primitive object={clonedScene} />
      <PodRing pods={node.pods} isCP={node.role === 'control-plane'} showHalos={showHalos} dimmed={dimmed} onClickThrough={() => onClick?.(node)} />

      <group position={[0, 0, targetSize * 0.55]}>
        <mesh ref={engineRef}>
          <sphereGeometry args={[targetSize * 0.05, 6, 6]} />
          <meshBasicMaterial color={nsColor} transparent opacity={0.35} />
        </mesh>
        <pointLight ref={engineLightRef} color={nsColor} intensity={0.6} distance={targetSize * 3} />
      </group>

      {hasCrash && (
        <mesh ref={crashRef} position={[targetSize * 0.25, targetSize * 0.3, -targetSize * 0.1]}>
          <sphereGeometry args={[targetSize * 0.09, 6, 6]} />
          <meshBasicMaterial color="#ff2200" transparent opacity={0.8} />
        </mesh>
      )}

      {showHalos && !dimmed && (hovered || health !== 'good') && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[targetSize * 0.85, targetSize * 1.0, 64]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.35} />
        </mesh>
      )}

      {hovered && (
        <Html distanceFactor={55} position={[0, targetSize * 0.9, 0]}>
          <div style={{
            background: 'rgba(0,5,20,0.94)',
            border: `1px solid ${ringColor}`,
            borderRadius: 5,
            padding: '8px 13px',
            color: '#c0e8ff',
            fontFamily: '"DM Mono", monospace',
            fontSize: 13,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: `0 0 12px ${ringColor}44`,
          }}>
            <div style={{ color: ringColor, fontWeight: 'bold', marginBottom: 4, fontSize: 14 }}>{node.name}</div>
            <div>CPU {Math.round(node.cpuPct * 100)}%  MEM {Math.round(node.memPct * 100)}%</div>
            <div style={{ color: '#6090b0', marginTop: 3, fontSize: 12 }}>{node.pods.length} pods · {node.role}</div>
          </div>
        </Html>
      )}
    </group>
  )
})
