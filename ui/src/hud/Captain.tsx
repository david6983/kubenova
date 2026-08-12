import { useState, useEffect, useMemo, useRef } from 'react'
import type { Cluster, ClusterNode } from '../types'

interface CaptainMsg {
  level: 'critical' | 'alert' | 'warn' | 'info'
  text: string
}

const LEVEL_COLOR = {
  critical: '#ff2200',
  alert:    '#ff5500',
  warn:     '#ffc700',
  info:     '#00b4ff',
}

function nodeHealth(node: ClusterNode) {
  if (!node.ready) return 'critical'
  const hasFailed = node.pods.some(p => p.status === 'failed' || p.status === 'crashloop')
  if (hasFailed || node.cpuPct > 0.8 || node.memPct > 0.85) return 'warn'
  return 'good'
}

// Cluster-derived strings (pod names, node names, event messages) are untrusted.
// Sanitize before embedding in any human-readable or LLM-bound message:
// strip control characters, collapse whitespace, cap length.
function sanitize(s: string, maxLen = 80): string {
  return s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

function buildMessages(cluster: Cluster): CaptainMsg[] {
  const msgs: CaptainMsg[] = []

  for (const node of cluster.nodes) {
    if (!node.ready)
      msgs.push({ level: 'critical', text: `${sanitize(node.name)} is unresponsive. Fleet integrity compromised.` })
  }

  for (const node of cluster.nodes) {
    for (const pod of node.pods) {
      if (pod.status === 'crashloop')
        msgs.push({ level: 'alert', text: `${sanitize(pod.name)} is looping on ${sanitize(node.name)}. System unstable.` })
      else if (pod.status === 'failed')
        msgs.push({ level: 'alert', text: `${sanitize(pod.name)} has failed. ${sanitize(node.name)} at reduced capacity.` })
    }
  }

  for (const node of cluster.nodes) {
    if (node.cpuPct > 0.85)
      msgs.push({ level: 'warn', text: `${sanitize(node.name)} at ${Math.round(node.cpuPct * 100)}% CPU. Recommend load redistribution.` })
    if (node.memPct > 0.88)
      msgs.push({ level: 'warn', text: `${sanitize(node.name)} memory at ${Math.round(node.memPct * 100)}%. OOM risk elevated.` })
  }

  const pending = cluster.nodes.flatMap(n => n.pods).filter(p => p.status === 'pending')
  if (pending.length)
    msgs.push({ level: 'info', text: `${pending.length} pod${pending.length > 1 ? 's' : ''} awaiting deployment. Scheduler working.` })

  const good = cluster.nodes.filter(n => nodeHealth(n) === 'good').length
  const total = cluster.nodes.length
  if (good === total)
    msgs.push({ level: 'info', text: `All ${total} vessels fully operational. Formation holding.` })
  else
    msgs.push({ level: 'info', text: `${good} of ${total} vessels operational. Monitoring fleet status.` })

  return msgs
}

export function Captain({ cluster }: { cluster: Cluster }) {
  const messages = useMemo(() => buildMessages(cluster), [cluster])
  const [idx, setIdx]             = useState(0)
  const [displayed, setDisplayed] = useState('')
  const [visible, setVisible]     = useState(true)
  const [cursor, setCursor]       = useState(true)
  const phaseRef = useRef<'typing' | 'hold' | 'out'>('typing')

  useEffect(() => {
    const t = setInterval(() => setCursor(c => !c), 400)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    phaseRef.current = 'typing'
    setDisplayed('')
    setVisible(true)
  }, [idx])

  useEffect(() => {
    const msg = messages[idx % messages.length]

    if (phaseRef.current === 'typing') {
      if (displayed.length < msg.text.length) {
        const t = setTimeout(() => setDisplayed(msg.text.slice(0, displayed.length + 1)), 18)
        return () => clearTimeout(t)
      } else {
        phaseRef.current = 'hold'
        const t = setTimeout(() => {
          phaseRef.current = 'out'
          setVisible(false)
          setTimeout(() => setIdx(i => (i + 1) % messages.length), 600)
        }, 3200)
        return () => clearTimeout(t)
      }
    }
  }, [displayed, idx, messages])

  const msg = messages[idx % messages.length]
  const color = LEVEL_COLOR[msg.level]
  const isTyping = displayed.length < msg.text.length

  return (
    <div style={{
      fontFamily: 'monospace',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.5s',
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(2,8,20,0.82)',
        border: `1px solid ${color}33`,
        borderLeft: `2px solid ${color}`,
        borderRadius: 5,
        padding: '8px 12px',
        backdropFilter: 'blur(4px)',
        maxWidth: 320,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
          <span style={{ color, fontSize: 10, letterSpacing: 1 }}>◈ CAPTAIN</span>
          {/* Speaking indicator */}
          <span style={{
            display: 'flex', gap: 2, alignItems: 'center',
          }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 2, height: isTyping ? 4 + i * 2 : 3,
                background: color,
                borderRadius: 1,
                opacity: isTyping ? 0.4 + i * 0.3 : 0.2,
                transition: 'height 0.15s, opacity 0.15s',
                display: 'inline-block',
              }} />
            ))}
          </span>
        </div>
        <div style={{ color: '#c0d8f0', fontSize: 10, lineHeight: 1.5, minHeight: 15 }}>
          {displayed}
          {isTyping && (
            <span style={{ opacity: cursor ? 1 : 0, color }}>▌</span>
          )}
        </div>
      </div>
    </div>
  )
}
