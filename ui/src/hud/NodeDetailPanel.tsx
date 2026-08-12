import { useState, useMemo, useEffect } from 'react'
import type { ClusterNode, Pod } from '../types'
import { getNsColor } from '../constants/namespaces'

// ── workload grouping ─────────────────────────────────────────────────────────

function workloadKey(name: string): string {
  return name.replace(/-[a-z0-9]{1,5}$/, '')
}

type WorkloadGroup = {
  key:         string
  label:       string
  namespace:   string
  kind:        Pod['workloadKind']
  pods:        Pod[]
  running:     number
  problematic: number
  cpuAvg:      number
  memAvg:      number
}

function groupByWorkload(pods: Pod[]): WorkloadGroup[] {
  const map = new Map<string, WorkloadGroup>()
  for (const pod of pods) {
    const key = workloadKey(pod.name)
    if (!map.has(key)) {
      map.set(key, { key, label: key, namespace: pod.namespace, kind: pod.workloadKind,
                     pods: [], running: 0, problematic: 0, cpuAvg: 0, memAvg: 0 })
    }
    const g = map.get(key)!
    g.pods.push(pod)
    if (pod.status === 'running') g.running++
    else g.problematic++
  }
  for (const g of map.values()) {
    g.cpuAvg = g.pods.reduce((s, p) => s + p.cpuPct, 0) / g.pods.length
    g.memAvg = g.pods.reduce((s, p) => s + p.memPct, 0) / g.pods.length
  }
  return [...map.values()].sort((a, b) => b.pods.length - a.pods.length)
}

const STATUS_COLOR: Record<Pod['status'], string> = {
  running:   '#00e87a',
  pending:   '#ffc700',
  failed:    '#ff2200',
  crashloop: '#ff5500',
}

const KIND_SHORT: Record<Pod['workloadKind'], string> = {
  deployment:  'deploy',
  statefulset: 'sts',
  daemonset:   'ds',
  other:       '?',
}

// ── sub-components ────────────────────────────────────────────────────────────

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 90, height: 4, background: '#071420', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value * 100}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color: '#6a9ab8', fontSize: 11, fontFamily: 'DM Mono,monospace', minWidth: 34 }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

function WorkloadRow({ g, open, onToggle }: { g: WorkloadGroup; open: boolean; onToggle: () => void }) {
  const nsColor    = getNsColor(g.namespace)
  const hasProblem = g.problematic > 0

  return (
    <div style={{ borderBottom: '1px solid #071520' }}>
      {/* Row header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 20px', cursor: 'pointer',
          background: open ? '#020d1c' : 'transparent',
          transition: 'background 0.1s',
        }}
      >
        {/* Namespace accent */}
        <div style={{ width: 3, height: 28, background: nsColor, borderRadius: 1, flexShrink: 0 }} />

        {/* Name + kind */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: hasProblem ? '#ff7733' : '#c8e0f4',
            fontSize: 13, fontFamily: 'DM Mono,monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {g.label}
          </div>
          <div style={{ color: '#294456', fontSize: 10, fontFamily: 'DM Mono,monospace', letterSpacing: 0.8, marginTop: 2 }}>
            {g.namespace} · {KIND_SHORT[g.kind]}
          </div>
        </div>

        {/* Pod count badges */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{
            background: '#002214', color: '#00e87a', borderRadius: 3,
            padding: '2px 8px', fontSize: 10, fontFamily: 'DM Mono,monospace',
          }}>
            {g.running}✓
          </span>
          {hasProblem && (
            <span style={{
              background: '#1e0800', color: '#ff5500', borderRadius: 3,
              padding: '2px 8px', fontSize: 10, fontFamily: 'DM Mono,monospace',
            }}>
              {g.problematic}⚠
            </span>
          )}
        </div>

        {/* Chevron */}
        <span style={{ color: '#1a3a50', fontSize: 11, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded pod list */}
      {open && (
        <div style={{ padding: '0 20px 14px 32px' }}>
          {/* Metrics */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 10, paddingTop: 8 }}>
            <div>
              <div style={{ color: '#1a3a50', fontSize: 9, letterSpacing: 1, marginBottom: 4, fontFamily: 'DM Mono,monospace' }}>CPU AVG</div>
              <Bar value={g.cpuAvg} color={g.cpuAvg > 0.8 ? '#ff5500' : '#00b4ff'} />
            </div>
            <div>
              <div style={{ color: '#1a3a50', fontSize: 9, letterSpacing: 1, marginBottom: 4, fontFamily: 'DM Mono,monospace' }}>MEM AVG</div>
              <Bar value={g.memAvg} color={g.memAvg > 0.85 ? '#ff2200' : '#00e87a'} />
            </div>
          </div>

          {/* Pod list */}
          {g.pods.map(pod => {
            const sc = STATUS_COLOR[pod.status]
            return (
              <div key={pod.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 0', borderTop: '1px solid #040e18',
              }}>
                <span style={{
                  color: sc, fontSize: 11, fontFamily: 'DM Mono,monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: 300, flexShrink: 1,
                }}>
                  {pod.name}
                </span>
                <span style={{ color: '#1e4060', fontSize: 10, fontFamily: 'DM Mono,monospace', flexShrink: 0, marginLeft: 12 }}>
                  {Math.round(pod.cpuPct * 100)}%·{Math.round(pod.memPct * 100)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── main panel ────────────────────────────────────────────────────────────────

export function NodeDetailPanel({ node, onClose }: { node: ClusterNode; onClose: () => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const groups = useMemo(() => groupByWorkload(node.pods), [node.pods])

  const totalRunning = node.pods.filter(p => p.status === 'running').length
  const totalBad     = node.pods.length - totalRunning
  const healthColor  = !node.ready ? '#ff2200' : totalBad > 0 ? '#ff5500' : '#00e87a'

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div style={{
      position: 'absolute',
      top: 0, right: 0,
      width: '75vw',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'DM Mono, Fira Mono, monospace',
      zIndex: 80,
      // Scanline overlay via background gradient
      background: `
        repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0,0,0,0.04) 2px,
          rgba(0,0,0,0.04) 4px
        ),
        rgba(1, 7, 18, 0.88)
      `,
      backdropFilter: 'blur(6px)',
      borderLeft: '1px solid #0a2030',
      boxShadow: '-12px 0 40px rgba(0,0,0,0.6)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 14px',
        borderBottom: '1px solid #0a1e2e',
        background: 'rgba(1,5,14,0.6)',
        flexShrink: 0,
      }}>
        {/* Top row: back + node name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <button onClick={onClose} style={{
            background: 'none',
            border: '1px solid #0d2638',
            color: '#2a5a7a',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 11,
            padding: '5px 12px',
            borderRadius: 2,
            letterSpacing: 1.5,
            flexShrink: 0,
          }}>
            ← FLEET
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: '#d8eeff', fontSize: 16, fontWeight: 'bold',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {node.name}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <span style={{ color: '#1a4060', fontSize: 10, letterSpacing: 1 }}>
                {node.role.toUpperCase()}
              </span>
              <span style={{ color: healthColor, fontSize: 10, letterSpacing: 1 }}>
                {!node.ready ? '✖ NOT READY' : totalBad > 0 ? '⚠ DEGRADED' : '● READY'}
              </span>
            </div>
          </div>

          <div style={{ color: '#0d2030', fontSize: 11, letterSpacing: 1, flexShrink: 0 }}>ESC</div>
        </div>

        {/* Metrics row */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={{ color: '#1a3a50', fontSize: 9, letterSpacing: 1, marginBottom: 5 }}>CPU</div>
            <Bar value={node.cpuPct} color={node.cpuPct > 0.8 ? '#ff5500' : '#00b4ff'} />
          </div>
          <div>
            <div style={{ color: '#1a3a50', fontSize: 9, letterSpacing: 1, marginBottom: 5 }}>MEM</div>
            <Bar value={node.memPct} color={node.memPct > 0.85 ? '#ff2200' : '#00e87a'} />
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <span style={{ color: '#00e87a', fontSize: 18, fontFamily: 'DM Mono,monospace' }}>{totalRunning}</span>
            {totalBad > 0 && (
              <span style={{ color: '#ff5500', fontSize: 15, fontFamily: 'DM Mono,monospace' }}> +{totalBad}⚠</span>
            )}
            <div style={{ color: '#1a3a50', fontSize: 9, letterSpacing: 1 }}>PODS</div>
          </div>
        </div>
      </div>

      {/* Section label */}
      <div style={{
        padding: '9px 20px 7px',
        color: '#0e2a3a',
        fontSize: 9,
        letterSpacing: 2,
        borderBottom: '1px solid #060f1a',
        flexShrink: 0,
      }}>
        WORKLOADS — {groups.length} SERVICES
      </div>

      {/* Scrollable workload list — two columns */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', alignContent: 'start' }}>
        {groups.map(g => (
          <WorkloadRow
            key={g.key}
            g={g}
            open={openGroup === g.key}
            onToggle={() => setOpenGroup(prev => prev === g.key ? null : g.key)}
          />
        ))}
      </div>

      {/* Bottom corner decoration */}
      <div style={{
        padding: '8px 20px',
        color: '#071420',
        fontSize: 9,
        letterSpacing: 2,
        borderTop: '1px solid #060f1a',
        flexShrink: 0,
      }}>
        ATH · KUBENOVA TACTICAL · {node.name.toUpperCase()}
      </div>
    </div>
  )
}
