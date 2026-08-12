import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Scene } from './scene/Scene'
import { HUD } from './hud/HUD'
import { useRealCluster } from './hooks/useRealCluster'
import { useSimulatedCluster } from './mock/useSimulatedCluster'
import type { SimEvent } from './mock/useSimulatedCluster'
import type { ClusterNode, Cluster } from './types'
import type { ClusterHealth } from './scene/Weather'

function computeHealth(cluster: Cluster): ClusterHealth {
  if (cluster.nodes.some(n => !n.ready)) return 'critical'
  const hasCrash = cluster.nodes.some(n =>
    n.pods.some(p => p.status === 'failed' || p.status === 'crashloop')
  )
  return hasCrash ? 'warn' : 'good'
}

function applyTrafficLevel(cluster: Cluster, level: number): Cluster {
  if (level < 0.02) return cluster
  const cpuScale = 0.3 + level * 0.9
  const memScale = 0.35 + level * 0.8
  return {
    ...cluster,
    nodes: cluster.nodes.map(node => ({
      ...node,
      cpuPct: Math.min(0.99, node.cpuPct * cpuScale),
      memPct: Math.min(0.99, node.memPct * memScale),
    })),
  }
}

const VIGNETTE = {
  good:     { color: 'transparent', opacity: 0 },
  warn:     { color: '#ff6600',     opacity: 0.10 },
  critical: { color: '#cc0000',     opacity: 0.18 },
}

interface CoreAppProps {
  clusterData:    Cluster
  events:         SimEvent[]
  simulation:     boolean
  onToggleMode:   () => void
}

function CoreApp({ clusterData, events, simulation, onToggleMode }: CoreAppProps) {
  const [showTraffic,    setShowTraffic]    = useState(false)
  const [showInbound,    setShowInbound]    = useState(false)
  const [showHalos,      setShowHalos]      = useState(true)
  const [showPodFlow,    setShowPodFlow]    = useState(false)
  const [trafficLevel,   setTrafficLevel]   = useState(0.5)
  const [healthOverride, setHealthOverride] = useState<ClusterHealth | null>(null)
  const [focusNs,        setFocusNs]        = useState<string | null>(null)
  const [selectedNode,   setSelectedNode]   = useState<ClusterNode | null>(null)

  const chaosDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chaosDidMount = useRef(false)
  useEffect(() => {
    if (!chaosDidMount.current) { chaosDidMount.current = true; return }
    if (chaosDebounce.current) clearTimeout(chaosDebounce.current)
    chaosDebounce.current = setTimeout(() => {
      const chaosLevel = healthOverride === 'critical' ? 3 : healthOverride === 'warn' ? 1 : 0
      fetch('http://localhost:9666/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trafficLevel: Math.round(trafficLevel * 100), chaosLevel }),
      }).catch(() => {})
    }, 400)
  }, [trafficLevel, healthOverride])

  const cluster = useMemo(
    () => applyTrafficLevel(clusterData, trafficLevel),
    [clusterData, trafficLevel],
  )

  const liveSelectedNode = useMemo(
    () => selectedNode ? (cluster.nodes.find(n => n.id === selectedNode.id) ?? null) : null,
    [selectedNode, cluster],
  )

  const computedHealth = useMemo(() => computeHealth(cluster), [cluster])
  const health    = healthOverride ?? computedHealth
  const vignette  = VIGNETTE[health]
  const speedMult = 0.2 + trafficLevel * trafficLevel * 4.8

  const openNode  = useCallback((node: ClusterNode) => setSelectedNode(node), [])
  const closeNode = useCallback(() => setSelectedNode(null), [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNode() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [closeNode])

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <Scene
        cluster={cluster}
        onSelectNode={openNode}
        selectedNode={liveSelectedNode}
        showTraffic={showTraffic}
        showInbound={showInbound}
        showHalos={showHalos}
        showPodFlow={showPodFlow}
        health={health}
        speedMult={speedMult}
        trafficLevel={trafficLevel}
        focusNs={focusNs}
      />

      {health !== 'good' && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at center, transparent 40%, ${vignette.color} 100%)`,
          opacity: vignette.opacity,
          pointerEvents: 'none',
          transition: 'opacity 2s ease',
        }} />
      )}

      {liveSelectedNode && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(1,5,14,0.82)',
          border: '1px solid #0d2638',
          borderRadius: 4,
          padding: '6px 16px',
          fontFamily: 'DM Mono, monospace',
          display: 'flex', alignItems: 'center', gap: 14,
          pointerEvents: 'none',
        }}>
          <span style={{ color: !liveSelectedNode.ready ? '#ff2200' : liveSelectedNode.pods.some(p => p.status === 'failed' || p.status === 'crashloop') ? '#ff5500' : '#00e87a', fontSize: 9 }}>
            {!liveSelectedNode.ready ? '✖' : liveSelectedNode.pods.some(p => p.status === 'failed' || p.status === 'crashloop') ? '⚠' : '●'}
          </span>
          <span style={{ color: '#c8e0f4', fontSize: 11, letterSpacing: 0.5 }}>{liveSelectedNode.name}</span>
          <span style={{ color: '#5a8aaa', fontSize: 8, letterSpacing: 1 }}>{liveSelectedNode.role.toUpperCase()}</span>
          <span style={{ color: '#5a8aaa', fontSize: 8 }}>·</span>
          <span style={{ color: '#2a5a7a', fontSize: 9 }}>
            <span style={{ color: '#00e87a' }}>{liveSelectedNode.pods.filter(p => p.status === 'running').length}</span>
            /{liveSelectedNode.pods.length} pods
          </span>
          <span style={{ color: '#0d2030', fontSize: 8, letterSpacing: 1 }}>ESC</span>
        </div>
      )}

      <HUD
        cluster={cluster}
        showTraffic={showTraffic}
        onToggleTraffic={() => setShowTraffic(v => !v)}
        showInbound={showInbound}
        onToggleInbound={() => setShowInbound(v => !v)}
        showHalos={showHalos}
        onToggleHalos={() => setShowHalos(v => !v)}
        showPodFlow={showPodFlow}
        onTogglePodFlow={() => setShowPodFlow(v => !v)}
        health={health}
        healthOverride={healthOverride}
        onHealthOverride={setHealthOverride}
        trafficLevel={trafficLevel}
        onTrafficLevel={setTrafficLevel}
        focusNs={focusNs}
        onFocusNs={setFocusNs}
        events={events}
      />

      {/* SIM / LIVE toggle */}
      <button
        onClick={onToggleMode}
        onMouseDown={e => e.preventDefault()}
        style={{
          position: 'absolute', top: 16, right: 220,
          background: simulation ? 'rgba(170,136,255,0.15)' : 'rgba(0,180,255,0.10)',
          border: `1px solid ${simulation ? '#aa88ff88' : 'rgba(0,180,255,0.30)'}`,
          borderRadius: 5,
          color: simulation ? '#aa88ff' : '#5a8aaa',
          fontFamily: '"DM Mono","Fira Mono",monospace',
          fontSize: 9, letterSpacing: 1.5,
          padding: '5px 10px',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          transition: 'all 0.15s',
        }}
      >
        {simulation ? '◈ SIM' : '● LIVE'}
      </button>
    </div>
  )
}

function AppSimulated({ onToggleMode }: { onToggleMode: () => void }) {
  const { cluster, events } = useSimulatedCluster()
  return <CoreApp clusterData={cluster} events={events} simulation onToggleMode={onToggleMode} />
}

function AppReal({ onToggleMode }: { onToggleMode: () => void }) {
  const { cluster, events } = useRealCluster()
  return <CoreApp clusterData={cluster} events={events} simulation={false} onToggleMode={onToggleMode} />
}

export default function App() {
  const [simulation, setSimulation] = useState(
    () => localStorage.getItem('kubeboat_sim') === '1'
  )

  const toggle = useCallback(() => {
    setSimulation(v => {
      localStorage.setItem('kubeboat_sim', v ? '0' : '1')
      return !v
    })
  }, [])

  return simulation
    ? <AppSimulated onToggleMode={toggle} />
    : <AppReal onToggleMode={toggle} />
}
