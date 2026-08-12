import { useEffect, useRef } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Space } from './Space'
import { Decorations } from './Decorations'
import { Fleet, getNodeWorldPos } from './Fleet'
import { Weather } from './Weather'
import type { ClusterHealth } from './Weather'
import type { Cluster, ClusterNode } from '../types'

const KEYS = new Set<string>()

function KeyboardPan({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        KEYS.add(e.key)
      }
    }
    const up = (e: KeyboardEvent) => KEYS.delete(e.key)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!controls || KEYS.size === 0) return
    const speed = 60 * delta
    const forward = new Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    const right = new Vector3()
    right.crossVectors(forward, new Vector3(0, 1, 0)).normalize()
    const move = new Vector3()
    if (KEYS.has('ArrowUp'))    move.addScaledVector(forward, speed)
    if (KEYS.has('ArrowDown'))  move.addScaledVector(forward, -speed)
    if (KEYS.has('ArrowLeft'))  move.addScaledVector(right, -speed)
    if (KEYS.has('ArrowRight')) move.addScaledVector(right, speed)
    camera.position.add(move)
    controls.target.add(move)
    controls.update()
  })

  return null
}

// ── Camera focus: lerps toward the selected node top-down, or back to fleet ──

function NodeFocusCamera({
  selectedNode,
  cluster,
  controlsRef,
}: {
  selectedNode:  ClusterNode | null
  cluster:       Cluster
  controlsRef:   React.RefObject<OrbitControlsImpl | null>
}) {
  const { camera } = useThree()
  const targetRef  = useRef<{ camPos: Vector3; ctrlTarget: Vector3 } | null>(null)
  const animating  = useRef(false)
  const clusterRef = useRef(cluster)
  clusterRef.current = cluster

  // Cancel on drag/orbit AND scroll zoom — wheel fires 'dolly', not 'start'
  useEffect(() => {
    const cancel = () => { animating.current = false }
    const controls = controlsRef.current
    controls?.addEventListener('start', cancel)
    window.addEventListener('wheel', cancel, { passive: true })
    return () => {
      controls?.removeEventListener('start', cancel)
      window.removeEventListener('wheel', cancel)
    }
  }, [controlsRef])

  // Only re-trigger on explicit node selection, NOT on every cluster update
  useEffect(() => {
    if (selectedNode) {
      const [nx, , nz] = getNodeWorldPos(selectedNode, clusterRef.current)
      targetRef.current = {
        camPos:     new Vector3(nx, 210, nz - 55),
        ctrlTarget: new Vector3(nx,   0, nz + 10),
      }
    } else {
      targetRef.current = {
        camPos:     new Vector3(0, 560, -750),
        ctrlTarget: new Vector3(0, 0, 0),
      }
    }
    animating.current = true
  }, [selectedNode])

  useFrame(() => {
    if (!animating.current || !targetRef.current) return
    const controls = controlsRef.current
    if (!controls) return

    camera.position.lerp(targetRef.current.camPos, 0.07)
    controls.target.lerp(targetRef.current.ctrlTarget, 0.07)
    controls.update()

    if (camera.position.distanceTo(targetRef.current.camPos) < 0.8) {
      animating.current = false
    }
  })

  return null
}

interface SceneProps {
  cluster:       Cluster
  onSelectNode:  (node: ClusterNode) => void
  selectedNode:  ClusterNode | null
  showTraffic:   boolean
  showInbound:   boolean
  showHalos:     boolean
  showPodFlow:   boolean
  health:        ClusterHealth
  speedMult:     number
  trafficLevel:  number
  focusNs:       string | null
}

export function Scene({
  cluster, onSelectNode, selectedNode, showTraffic, showInbound, showHalos, showPodFlow,
  health, speedMult, trafficLevel, focusNs,
}: SceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)

  return (
    <Canvas
      camera={{ position: [0, 560, -750], fov: 55, near: 0.1, far: 6000 }}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      dpr={[1, 1.2]}
      performance={{ min: 0.5 }}
    >
      <NodeFocusCamera selectedNode={selectedNode} cluster={cluster} controlsRef={controlsRef} />

      <Space />
      <ambientLight intensity={0.8} color="#c0d8ff" />
      <directionalLight position={[50, 100, -100]} intensity={2.5} color="#ffffff" />
      <directionalLight position={[-50, 50, 100]} intensity={1.0} color="#6699ff" />
      <pointLight position={[0, 50, 120]} intensity={1.5} color="#4477ff" distance={600} />
      <fog attach="fog" args={['#0d0025', 800, 2200]} />
      <Weather health={health} />
      <Decorations />
      <Fleet
        cluster={cluster}
        onSelectNode={onSelectNode}
        selectedNode={selectedNode}
        showTraffic={showTraffic}
        showInbound={showInbound}
        showHalos={showHalos}
        showPodFlow={showPodFlow}
        speedMult={speedMult}
        trafficLevel={trafficLevel}
        health={health}
        focusNs={focusNs}
      />

      <OrbitControls
        ref={controlsRef}
        target={[0, 0, 0]}
        minDistance={30}
        maxDistance={2400}
        maxPolarAngle={Math.PI * 0.48}
        enablePan
        enableRotate
        panSpeed={0.8}
        rotateSpeed={0.6}
        zoomSpeed={1.2}
        zoomToCursor
      />
      <KeyboardPan controlsRef={controlsRef} />

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={selectedNode ? 0.8 : 0.5}
          luminanceThreshold={0.72}
          luminanceSmoothing={0.4}
          mipmapBlur
          levels={2}
        />
      </EffectComposer>
    </Canvas>
  )
}
