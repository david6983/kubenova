import { useRef, useEffect, useMemo, useState } from 'react'
import type { Cluster, Pod } from '../types'
import type { ClusterHealth } from '../scene/Weather'
import type { SimEvent } from '../mock/useSimulatedCluster'
import { NS_COLORS, getNsColor, dominantNamespace } from '../constants/namespaces'
import { CrewPanel } from './CrewPanel'
import { Captain } from './Captain'

// ─── Shared primitives ────────────────────────────────────────────────────────

const STATUS_COLOR: Record<Pod['status'], string> = {
  running:   '#00e87a',
  pending:   '#ffc700',
  failed:    '#ff2200',
  crashloop: '#ff5500',
}

function nodeHealth(node: ClusterNode): 'good' | 'warn' | 'critical' {
  if (!node.ready) return 'critical'
  const hasFailed = node.pods.some(p => p.status === 'failed' || p.status === 'crashloop')
  if (hasFailed || node.cpuPct > 0.8 || node.memPct > 0.85) return 'warn'
  return 'good'
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 2, height: 3, width: '100%' }}>
      <div style={{ height: '100%', width: `${Math.round(value * 100)}%`, background: color, borderRadius: 2, transition: 'width 0.4s' }} />
    </div>
  )
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'rgba(2,6,18,0.88)',
      border: '1px solid rgba(0,180,255,0.30)',
      borderRadius: 8,
      fontFamily: '"DM Mono", "Fira Mono", monospace',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, color: '#5a8aaa', letterSpacing: 2, fontWeight: 700, textTransform: 'uppercase' as const, marginBottom: 6 }}>
      {children}
    </div>
  )
}

// ─── Top-left: fleet overview ─────────────────────────────────────────────────

const HEALTH_STATUS = {
  good:     { label: 'ALL SYSTEMS GO',   color: '#00e87a' },
  warn:     { label: 'SYSTEMS DEGRADED', color: '#ffc700' },
  critical: { label: 'CRITICAL ALERT',   color: '#ff2200' },
}

function FleetWidget({ cluster, health }: { cluster: Cluster; health: ClusterHealth }) {
  const totalPods = cluster.nodes.reduce((s, n) => s + n.pods.length, 0)
  const cp      = cluster.nodes.filter(n => n.role === 'control-plane').length
  const workers = cluster.nodes.filter(n => n.role === 'worker').length
  const hs = HEALTH_STATUS[health]

  return (
    <Panel style={{ padding: '12px 16px', minWidth: 190 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span style={{ color: '#00b4ff', fontSize: 13, lineHeight: 1 }}>◈</span>
        <span style={{ color: '#deeeff', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>KUBEBOAT</span>
        <span style={{ color: '#4a7a9a', fontSize: 9, marginLeft: 2 }}>{cluster.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: hs.color, boxShadow: `0 0 8px ${hs.color}`,
          display: 'inline-block',
        }} />
        <span style={{ color: hs.color, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>{hs.label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
        {[
          { val: cp,        label: 'COMMAND' },
          { val: workers,   label: 'FIGHTERS' },
          { val: totalPods, label: 'PODS' },
        ].map(({ val, label }) => (
          <div key={label} style={{ textAlign: 'center' as const, padding: '0 4px' }}>
            <div style={{ color: '#deeeff', fontSize: 18, fontWeight: 700, lineHeight: 1, letterSpacing: -1 }}>{val}</div>
            <div style={{ color: '#5a8aaa', fontSize: 8, marginTop: 3, letterSpacing: 1 }}>{label}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── Top-right: alerts ────────────────────────────────────────────────────────

function AlertWidget({ cluster }: { cluster: Cluster }) {
  const failing  = cluster.nodes.flatMap(n => n.pods).filter(p => p.status === 'failed' || p.status === 'crashloop')
  const offline  = cluster.nodes.filter(n => !n.ready)
  const warnings = cluster.nodes.filter(n => nodeHealth(n) === 'warn')
  if (!failing.length && !offline.length) return null

  return (
    <Panel style={{ padding: '10px 14px', minWidth: 170, borderColor: offline.length ? '#ff220030' : '#ffc70030' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {offline.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span style={{ color: '#ff2200', fontSize: 13, lineHeight: 1.2, flexShrink: 0 }}>✖</span>
            <div>
              <div style={{ color: '#ff2200', fontSize: 10, fontWeight: 700 }}>{offline.length} OFFLINE</div>
              <div style={{ color: '#aa5555', fontSize: 8, marginTop: 1 }}>{offline.map(n => n.name).join(', ')}</div>
            </div>
          </div>
        )}
        {failing.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span style={{ color: '#ff5500', fontSize: 13, lineHeight: 1.2, flexShrink: 0 }}>⚠</span>
            <div>
              <div style={{ color: '#ff5500', fontSize: 10, fontWeight: 700 }}>{failing.length} IN DISTRESS</div>
              <div style={{ color: '#aa6633', fontSize: 8, marginTop: 1 }}>pods failing or crashing</div>
            </div>
          </div>
        )}
        {warnings.length > offline.length && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: '#ffc700', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>●</span>
            <div style={{ color: '#ffc700', fontSize: 10, fontWeight: 700 }}>{warnings.length} VESSELS DEGRADED</div>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ─── Top-right: controls ──────────────────────────────────────────────────────

function ControlsWidget({
  trafficLevel, onTrafficLevel,
  healthOverride, onHealthOverride,
}: {
  trafficLevel: number; onTrafficLevel: (v: number) => void
  healthOverride: ClusterHealth | null; onHealthOverride: (h: ClusterHealth | null) => void
}) {
  const pct = Math.round(trafficLevel * 100)
  const loadColor = pct > 88 ? '#ff2200' : pct > 70 ? '#ffc700' : '#00e87a'

  return (
    <Panel style={{ padding: '10px 12px', minWidth: 190 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <SectionLabel>TRAFFIC LOAD</SectionLabel>
          <span style={{ color: loadColor, fontSize: 11, fontWeight: 700 }}>{pct}%</span>
        </div>
        <input
          type="range" min={0} max={100} value={pct}
          onChange={e => onTrafficLevel(Number(e.target.value) / 100)}
          style={{ width: '100%', height: 3, cursor: 'pointer', accentColor: loadColor }}
        />
      </div>
      <div>
        <SectionLabel>WEATHER OVERRIDE</SectionLabel>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['good', 'warn', 'critical'] as ClusterHealth[]).map(h => {
            const col = h === 'good' ? '#00e87a' : h === 'warn' ? '#ffc700' : '#ff2200'
            const active = healthOverride === h
            return (
              <button key={h} onClick={() => onHealthOverride(active ? null : h)}
                onMouseDown={e => e.preventDefault()}
                style={{
                  flex: 1, padding: '3px 0',
                  background: active ? `${col}20` : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${active ? col : 'rgba(255,255,255,0.16)'}`,
                  borderRadius: 4, color: active ? col : '#6a9aaa',
                  fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                {h === 'good' ? '☀' : h === 'warn' ? '⚡' : '☢'}
              </button>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

// ─── Bottom-left: event log ───────────────────────────────────────────────────

const SEV_COLOR: Record<SimEvent['severity'], string> = {
  info:     '#00b4ff',
  warn:     '#ffc700',
  critical: '#ff2200',
  resolved: '#00e87a',
}
const SEV_LABEL: Record<SimEvent['severity'], string> = {
  info:     'INFO',
  warn:     'WARN',
  critical: 'CRIT',
  resolved: 'OK  ',
}

function EventLog({ events }: { events: SimEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [events.length])

  return (
    <Panel style={{ width: 320, overflow: 'hidden' }}>
      <div style={{
        padding: '7px 12px', borderBottom: '1px solid rgba(0,180,255,0.20)',
        fontSize: 9, color: '#00b4ff', letterSpacing: 2, fontWeight: 700,
      }}>
        ◈ OPERATIONS LOG
      </div>
      <div ref={scrollRef} style={{ maxHeight: 160, overflowY: 'auto', padding: '2px 0' }}>
        {events.length === 0 ? (
          <div style={{ color: '#4a7a9a', fontSize: 9, padding: '8px 12px', fontStyle: 'italic' }}>
            All systems nominal…
          </div>
        ) : events.map((ev, i) => (
          <div key={ev.id} style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            padding: '4px 12px', opacity: Math.max(0.25, 1 - i * 0.07),
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{
              color: SEV_COLOR[ev.severity], fontSize: 8, fontWeight: 700,
              flexShrink: 0, letterSpacing: 0.5, marginTop: 1,
              textShadow: `0 0 6px ${SEV_COLOR[ev.severity]}`,
            }}>
              {SEV_LABEL[ev.severity]}
            </span>
            <span style={{ color: i === 0 ? '#c8e8ff' : '#7aaabb', fontSize: 9, lineHeight: 1.5 }}>
              {ev.message}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── Selected node panel ──────────────────────────────────────────────────────

function SelectedPanel({ node, onClose }: { node: ClusterNode; onClose: () => void }) {
  const health = nodeHealth(node)
  const borderColor = health === 'critical' ? '#ff2200' : health === 'warn' ? '#ffc700' : '#00b4ff'
  const cpu = node.cpuPct
  const mem = node.memPct
  const cpuColor = cpu > 0.8 ? '#ff5500' : cpu > 0.6 ? '#ffc700' : '#00e87a'
  const memColor = mem > 0.85 ? '#ff2200' : mem > 0.7 ? '#ffc700' : '#00e87a'
  const nsColor  = getNsColor(dominantNamespace(node.pods))

  const podsByNs = useMemo(() => {
    const map: Record<string, Pod[]> = {}
    for (const p of node.pods) {
      if (!map[p.namespace]) map[p.namespace] = []
      map[p.namespace].push(p)
    }
    return Object.entries(map)
  }, [node])

  return (
    <div style={{
      background: 'rgba(2,6,18,0.94)',
      border: `1px solid ${borderColor}30`,
      borderTop: `2px solid ${borderColor}`,
      borderRadius: 8,
      fontFamily: '"DM Mono", "Fira Mono", monospace',
      width: 240, maxHeight: 360,
      display: 'flex', flexDirection: 'column',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: nsColor, boxShadow: `0 0 8px ${nsColor}`, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#deeeff', fontWeight: 700, fontSize: 12 }}>{node.name}</span>
          </div>
          <span onClick={onClose} style={{ cursor: 'pointer', color: '#5a8aaa', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</span>
        </div>
        <div style={{ fontSize: 8, color: '#5a88a8', marginBottom: 10, letterSpacing: 0.5 }}>
          {node.role === 'control-plane' ? '◈ COMMAND SHIP' : '▲ FIGHTER'}
          {' · '}
          <span style={{ color: node.ready ? '#00e87a' : '#ff2200' }}>{node.ready ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'CPU', value: cpu, color: cpuColor },
            { label: 'MEM', value: mem, color: memColor },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6a9aaa', marginBottom: 4 }}>
                <span>{label}</span><span style={{ color }}>{Math.round(value * 100)}%</span>
              </div>
              <Bar value={value} color={color} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px' }}>
        {podsByNs.map(([ns, pods]) => (
          <div key={ns} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 8, color: '#5a8aaa', marginBottom: 4, letterSpacing: 1 }}>
              {ns}
            </div>
            {pods.map(pod => (
              <div key={pod.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '2px 0', gap: 8 }}>
                <span style={{ color: '#7aaabb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pod.name}
                </span>
                <span style={{ color: STATUS_COLOR[pod.status], fontWeight: pod.status !== 'running' ? 700 : 400, flexShrink: 0 }}>
                  {pod.status === 'crashloop' ? '⚠ loop' : pod.status}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Legend panel ─────────────────────────────────────────────────────────────

function LegendPanel() {
  const [open, setOpen] = useState(false)

  const sections = [
    { title: 'VESSELS', items: [
      { dot: '#00e87a', label: 'Healthy node' },
      { dot: '#ffc700', label: 'Degraded — high load / pod failures' },
      { dot: '#ff2200', label: 'Critical — crash / not ready' },
    ]},
    { title: 'INBOUND REQUESTS', items: [
      { dot: '#44ff88', label: '2xx  Success',      square: true },
      { dot: '#ffaa22', label: '4xx  Client error', square: true },
      { dot: '#ff3333', label: '5xx  Server error', square: true },
    ]},
    { title: 'SERVICE MESH', items: [
      { dot: '#00b4ff', label: 'Network  (HTTP / gRPC)' },
      { dot: '#00e87a', label: 'Data  (DB / cache / Kafka)' },
      { dot: '#ffc700', label: 'Degraded route' },
      { dot: '#ff2200', label: 'Blocked route' },
    ]},
    { title: 'SQUADRONS', items: Object.entries(NS_COLORS).slice(0, 5).map(([ns, col]) => ({ dot: col, label: ns })) },
  ]

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        onMouseDown={e => e.preventDefault()}
        style={{
          background: open ? 'rgba(0,180,255,0.28)' : 'rgba(2,6,18,0.80)',
          border: `1px solid ${open ? 'rgba(0,180,255,0.3)' : 'rgba(0,180,255,0.28)'}`,
          borderRadius: 6, color: open ? '#00b4ff' : '#5a88a8',
          fontFamily: '"DM Mono", "Fira Mono", monospace',
          fontSize: 9, padding: '5px 10px', letterSpacing: 1,
          cursor: 'pointer', transition: 'all 0.15s',
          backdropFilter: 'blur(8px)',
        }}
      >
        ? LEGEND
      </button>
      {open && (
        <Panel style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
          width: 260, padding: '12px 14px',
        }}>
          {sections.map(({ title, items }) => (
            <div key={title} style={{ marginBottom: 12 }}>
              <SectionLabel>{title}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {items.map(({ dot, label, square }: { dot: string; label: string; square?: boolean }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: square ? 9 : 7, height: square ? 5 : 7,
                      borderRadius: square ? 1 : '50%',
                      background: dot, flexShrink: 0,
                      boxShadow: `0 0 5px ${dot}88`,
                    }} />
                    <span style={{ color: '#7aaabb', fontSize: 9 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}

// ─── Bottom bar: namespace filter + view toggles ──────────────────────────────

function ToggleBtn({ active, color = '#00b4ff', onClick, children }: {
  active: boolean; color?: string; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={e => e.preventDefault()}
      style={{
        background: active ? `${color}18` : 'transparent',
        border: `1px solid ${active ? `${color}88` : 'rgba(255,255,255,0.16)'}`,
        borderRadius: 5, color: active ? color : '#5a8aaa',
        fontFamily: '"DM Mono", "Fira Mono", monospace',
        fontSize: 9, padding: '4px 10px', letterSpacing: 1,
        cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
      }}
    >
      {children}
    </button>
  )
}

function SquadronPanel({ cluster, focusNs, onFocusNs }: {
  cluster: Cluster; focusNs: string | null; onFocusNs: (ns: string | null) => void
}) {
  const namespaces = useMemo(() => {
    const counts: Record<string, number> = {}
    cluster.nodes.flatMap(n => n.pods).forEach(p => {
      if (NS_COLORS[p.namespace]) counts[p.namespace] = (counts[p.namespace] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([ns]) => ns)
  }, [cluster])

  return (
    <Panel style={{ padding: '10px 10px' }}>
      <div style={{ fontSize: 8, color: '#4a7a9a', letterSpacing: 2, fontWeight: 700, marginBottom: 8, textAlign: 'center' as const }}>
        SQUADRON
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {focusNs && (
          <>
            <button onClick={() => onFocusNs(null)} onMouseDown={e => e.preventDefault()}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
                color: '#5a8aaa', fontSize: 8,
                fontFamily: '"DM Mono", "Fira Mono", monospace',
                letterSpacing: 0.5, transition: 'color 0.15s',
              }}>
              ✕ clear filter
            </button>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '2px 0' }} />
          </>
        )}
        {namespaces.map(ns => {
          const col = getNsColor(ns)
          const active = focusNs === ns
          return (
            <button key={ns} onClick={() => onFocusNs(active ? null : ns)}
              onMouseDown={e => e.preventDefault()}
              style={{
                display: 'flex', alignItems: 'center',
                background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 5, padding: '5px 10px',
                cursor: 'pointer', transition: 'all 0.15s',
                textAlign: 'left' as const,
              }}>
              <span style={{
                color: active ? '#deeeff' : '#5a8aaa',
                fontSize: 9, letterSpacing: 0.5,
                fontFamily: '"DM Mono", "Fira Mono", monospace',
                transition: 'color 0.15s',
              }}>
                {ns}
              </span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

function BottomBar({
  showTraffic, onToggleTraffic,
  showInbound, onToggleInbound,
  showHalos, onToggleHalos,
  showPodFlow, onTogglePodFlow,
  onOpenCrew,
}: {
  showTraffic: boolean; onToggleTraffic: () => void
  showInbound: boolean; onToggleInbound: () => void
  showHalos: boolean; onToggleHalos: () => void
  showPodFlow: boolean; onTogglePodFlow: () => void
  onOpenCrew: () => void
}) {
  const divider = <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
  return (
    <Panel style={{ padding: '6px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#4a7a9a', fontSize: 8, letterSpacing: 1.5, fontWeight: 700, flexShrink: 0 }}>VIEW</span>
        {divider}
        <ToggleBtn active={showTraffic} onClick={onToggleTraffic} color="#00b4ff">⬡ FLOWS</ToggleBtn>
        <ToggleBtn active={showInbound} onClick={onToggleInbound} color="#ffcc66">↯ INBOUND</ToggleBtn>
        <ToggleBtn active={showHalos}   onClick={onToggleHalos}   color="#00e87a">◎ HALOS</ToggleBtn>
        <ToggleBtn active={showPodFlow} onClick={onTogglePodFlow} color="#aa88ff">◈ POD MESH</ToggleBtn>
        {divider}
        <ToggleBtn active={false} onClick={onOpenCrew} color="#4488ff">⚑ CREW</ToggleBtn>
      </div>
    </Panel>
  )
}

// ─── Interior HUD ─────────────────────────────────────────────────────────────

const HEALTH_COLOR_INT = { good: '#00e87a', warn: '#ffaa22', critical: '#ff2200' }

function InteriorHUD({ node, onExit }: { node: ClusterNode; onExit: () => void }) {
  const health = nodeHealth(node)
  const hColor = HEALTH_COLOR_INT[health]
  const podCount   = node.pods.length
  const runningCt  = node.pods.filter(p => p.status === 'running').length
  const problemCt  = node.pods.filter(p => p.status === 'failed' || p.status === 'crashloop').length

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Back button + breadcrumb */}
      <div style={{ position: 'absolute', top: 20, left: 20, pointerEvents: 'all' }}>
        <button
          onClick={onExit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(2,6,18,0.85)',
            border: '1px solid rgba(0,180,255,0.22)',
            borderRadius: 6,
            color: '#7ab8d8',
            fontFamily: '"DM Mono","Fira Mono",monospace',
            fontSize: 11,
            padding: '7px 14px',
            cursor: 'pointer',
            letterSpacing: 1,
            backdropFilter: 'blur(8px)',
            transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,180,255,0.5)'
            ;(e.currentTarget as HTMLButtonElement).style.color = '#c0e8ff'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,180,255,0.22)'
            ;(e.currentTarget as HTMLButtonElement).style.color = '#7ab8d8'
          }}
        >
          ← FLEET VIEW
        </button>
        <div style={{
          marginTop: 8,
          fontFamily: '"DM Mono","Fira Mono",monospace',
          fontSize: 9,
          color: '#2a5a7a',
          letterSpacing: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ color: hColor }}>◈</span>
          {node.name.toUpperCase()}
          <span style={{ color: '#4a7a9a' }}>·</span>
          {node.role.toUpperCase()}
        </div>
      </div>

      {/* Pod status summary — top right */}
      <div style={{
        position: 'absolute', top: 20, right: 20,
        background: 'rgba(2,6,18,0.82)',
        border: '1px solid rgba(0,180,255,0.28)',
        borderRadius: 6,
        padding: '10px 16px',
        fontFamily: '"DM Mono","Fira Mono",monospace',
        backdropFilter: 'blur(8px)',
        minWidth: 140,
      }}>
        <div style={{ fontSize: 8, color: '#5a8aaa', letterSpacing: 2, marginBottom: 8 }}>
          CREW MANIFEST
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <span style={{ color: '#5aaa7a', fontSize: 9 }}>● RUNNING</span>
            <span style={{ color: '#c0f0d8', fontSize: 9, fontWeight: 700 }}>{runningCt}</span>
          </div>
          {problemCt > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
              <span style={{ color: '#5a2a2a', fontSize: 9 }}>⚠ PROBLEM</span>
              <span style={{ color: '#ff8844', fontSize: 9, fontWeight: 700 }}>{problemCt}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 4, marginTop: 2 }}>
            <span style={{ color: '#4a7a9a', fontSize: 9 }}>TOTAL</span>
            <span style={{ color: '#6a8aa8', fontSize: 9 }}>{podCount}</span>
          </div>
        </div>
      </div>

      {/* ESC hint */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%',
        transform: 'translateX(-50%)',
        fontFamily: '"DM Mono","Fira Mono",monospace',
        fontSize: 9,
        color: '#0e2a40',
        letterSpacing: 2,
        pointerEvents: 'none',
      }}>
        ESC · RETURN TO FLEET
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

interface HUDProps {
  cluster:          Cluster
  showTraffic:      boolean
  onToggleTraffic:  () => void
  showInbound:      boolean
  onToggleInbound:  () => void
  showHalos:        boolean
  onToggleHalos:    () => void
  showPodFlow:      boolean
  onTogglePodFlow:  () => void
  health:           ClusterHealth
  healthOverride:   ClusterHealth | null
  onHealthOverride: (h: ClusterHealth | null) => void
  trafficLevel:     number
  onTrafficLevel:   (v: number) => void
  focusNs:          string | null
  onFocusNs:        (ns: string | null) => void
  events:           SimEvent[]
}

export function HUD({
  cluster,
  showTraffic, onToggleTraffic,
  showInbound, onToggleInbound,
  showHalos, onToggleHalos,
  showPodFlow, onTogglePodFlow,
  health, healthOverride, onHealthOverride,
  trafficLevel, onTrafficLevel,
  focusNs, onFocusNs,
  events,
}: HUDProps) {
  const [showCrew, setShowCrew] = useState(false)

  return (
    <>
      {/* Top-left */}
      <div style={{ position: 'absolute', top: 16, left: 16, pointerEvents: 'none' }}>
        <FleetWidget cluster={cluster} health={health} />
      </div>

      {/* Top-right */}
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <ControlsWidget
          trafficLevel={trafficLevel} onTrafficLevel={onTrafficLevel}
          healthOverride={healthOverride} onHealthOverride={onHealthOverride}
        />
        <AlertWidget cluster={cluster} />
      </div>

      {/* Bottom-left */}
      <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        <Captain cluster={cluster} />
        <EventLog events={events} />
      </div>

      {/* Bottom-center: view toggles */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
        <BottomBar
          showTraffic={showTraffic} onToggleTraffic={onToggleTraffic}
          showInbound={showInbound} onToggleInbound={onToggleInbound}
          showHalos={showHalos} onToggleHalos={onToggleHalos}
          showPodFlow={showPodFlow} onTogglePodFlow={onTogglePodFlow}
          onOpenCrew={() => setShowCrew(true)}
        />
      </div>

      {/* Left-center: squadron namespace filter */}
      <div style={{ position: 'absolute', top: '50%', left: 16, transform: 'translateY(-50%)' }}>
        <SquadronPanel cluster={cluster} focusNs={focusNs} onFocusNs={onFocusNs} />
      </div>

      {/* Bottom-right */}
      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <LegendPanel />
      </div>

      {showCrew && <CrewPanel onClose={() => setShowCrew(false)} />}
    </>
  )
}
