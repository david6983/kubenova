import { useState, useEffect, useRef } from 'react'
import type { Cluster, ClusterNode, Pod } from '../types'
import { mockCluster } from './cluster'

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventSeverity = 'info' | 'warn' | 'critical' | 'resolved'

export interface SimEvent {
  id:       string
  t:        number   // seconds since start
  severity: EventSeverity
  message:  string
}

interface ScriptEntry {
  t:            number
  nodeId:       string
  podName?:     string
  status?:      Pod['status']
  nodeReady?:   boolean
  cpuPct?:      number
  memPct?:      number
  severity:     EventSeverity
  message:      string
  addPod?:      Pod
  removePod?:   boolean
}

// ── Baseline cluster (all nominal) ───────────────────────────────────────────
// Deep clone mockCluster and fix all problems so we start from a clean state

function makeBaseline(): Cluster {
  const clone: Cluster = JSON.parse(JSON.stringify(mockCluster))
  for (const node of clone.nodes) {
    node.ready = true
    for (const pod of node.pods) {
      if (pod.status === 'crashloop' || pod.status === 'failed') {
        pod.status = 'running'
        pod.cpuPct = 0.05
        pod.memPct = 0.08
      }
      if (pod.status === 'pending') {
        pod.status = 'running'
        pod.cpuPct = 0.04
        pod.memPct = 0.06
      }
    }
    // Fix node metrics that were too high
    if (node.id === 'w-11') { node.cpuPct = 0.18; node.memPct = 0.28 }
    if (node.id === 'w-7')  { node.cpuPct = 0.60; node.memPct = 0.65 }
  }
  return clone
}

// ── Scenario script ───────────────────────────────────────────────────────────
// Total cycle: 130 seconds

// CronJob pods that appear/disappear on a patrol schedule
const CJ_PODS: Record<string, Pod> = {
  'nightly-report-7d2k': {
    id: 'cj-report-001', name: 'nightly-report-7d2k', namespace: 'data',
    status: 'running', cpuPct: 0.08, memPct: 0.12, workloadKind: 'cronjob',
  },
  'db-cleanup-k9m2': {
    id: 'cj-cleanup-001', name: 'db-cleanup-k9m2', namespace: 'data',
    status: 'running', cpuPct: 0.05, memPct: 0.08, workloadKind: 'cronjob',
  },
  'invoice-batch-x4f1': {
    id: 'cj-invoice-001', name: 'invoice-batch-x4f1', namespace: 'payments',
    status: 'running', cpuPct: 0.12, memPct: 0.15, workloadKind: 'cronjob',
  },
  'ml-retrain-p3c8': {
    id: 'cj-ml-001', name: 'ml-retrain-p3c8', namespace: 'ml',
    status: 'running', cpuPct: 0.22, memPct: 0.35, workloadKind: 'cronjob',
  },
}

const SCRIPT: ScriptEntry[] = [
  // ── CronJob patrol launches ───────────────────────────────────────────────
  {
    t: 3, nodeId: 'w-0', addPod: CJ_PODS['nightly-report-7d2k'],
    severity: 'info', message: 'PATROL — nightly-report-7d2k launched from node-api-01',
  },
  {
    t: 6, nodeId: 'w-3', addPod: CJ_PODS['db-cleanup-k9m2'],
    severity: 'info', message: 'PATROL — db-cleanup-k9m2 launched from node-orders-02',
  },
  {
    t: 9, nodeId: 'w-9', addPod: CJ_PODS['invoice-batch-x4f1'],
    severity: 'info', message: 'PATROL — invoice-batch-x4f1 launched from node-payments-03',
  },
  {
    t: 12, nodeId: 'w-14', addPod: CJ_PODS['ml-retrain-p3c8'],
    severity: 'info', message: 'PATROL — ml-retrain-p3c8 launched from node-ml-01',
  },
  // CronJob missions complete (pods return to base = disappear)
  {
    t: 44, nodeId: 'w-0', podName: 'nightly-report-7d2k', removePod: true,
    severity: 'info', message: 'PATROL — nightly-report-7d2k mission complete',
  },
  {
    t: 50, nodeId: 'w-3', podName: 'db-cleanup-k9m2', removePod: true,
    severity: 'info', message: 'PATROL — db-cleanup-k9m2 mission complete',
  },
  {
    t: 55, nodeId: 'w-9', podName: 'invoice-batch-x4f1', removePod: true,
    severity: 'info', message: 'PATROL — invoice-batch-x4f1 mission complete',
  },
  {
    t: 60, nodeId: 'w-14', podName: 'ml-retrain-p3c8', removePod: true,
    severity: 'info', message: 'PATROL — ml-retrain-p3c8 mission complete',
  },
  // Second patrol wave
  {
    t: 75, nodeId: 'w-0', addPod: CJ_PODS['nightly-report-7d2k'],
    severity: 'info', message: 'PATROL — nightly-report-7d2k re-launched',
  },
  {
    t: 80, nodeId: 'w-9', addPod: CJ_PODS['invoice-batch-x4f1'],
    severity: 'info', message: 'PATROL — invoice-batch-x4f1 re-launched',
  },
  {
    t: 112, nodeId: 'w-0', podName: 'nightly-report-7d2k', removePod: true,
    severity: 'info', message: 'PATROL — nightly-report-7d2k mission complete',
  },
  {
    t: 120, nodeId: 'w-9', podName: 'invoice-batch-x4f1', removePod: true,
    severity: 'info', message: 'PATROL — invoice-batch-x4f1 mission complete',
  },

  // ── Phase 2 : First anomaly ───────────────────────────────────────────────
  {
    t: 18, nodeId: 'w-4', podName: 'refund-worker-1c5v',
    status: 'crashloop', cpuPct: 0.01, memPct: 0.03,
    severity: 'warn',
    message: 'VESSEL node-payments-02 — refund-worker-1c5v entering crash loop',
  },
  {
    t: 26, nodeId: 'w-2', podName: 'invoice-generator-5k1z',
    status: 'failed', cpuPct: 0.00, memPct: 0.02,
    severity: 'warn',
    message: 'VESSEL node-orders-01 — invoice-generator-5k1z terminated (OOMKilled)',
  },

  // ── Phase 3 : Escalation ─────────────────────────────────────────────────
  {
    t: 36, nodeId: 'w-7',
    cpuPct: 0.94, memPct: 0.91,
    severity: 'warn',
    message: 'VESSEL node-reco-01 — CPU 94% MEM 91% — combat systems overheating',
  },
  {
    t: 40, nodeId: 'w-7', podName: 'feature-store-2k8p',
    status: 'failed', cpuPct: 0.00, memPct: 0.02,
    severity: 'warn',
    message: 'VESSEL node-reco-01 — feature-store-2k8p destroyed (resource limit)',
  },
  {
    t: 48, nodeId: 'w-8', podName: 'model-serving-5v1k',
    status: 'failed', cpuPct: 0.00, memPct: 0.02,
    severity: 'critical',
    message: 'VESSEL node-reco-02 — model-serving-5v1k destroyed — ML systems offline',
  },
  {
    t: 56, nodeId: 'w-11', podName: 'external-secrets-5k2p',
    status: 'crashloop', cpuPct: 0.01, memPct: 0.03,
    severity: 'critical',
    message: 'VESSEL node-infra-01 — external-secrets-5k2p crash loop — secrets rotation failing',
  },

  // ── Phase 4 : Crisis ─────────────────────────────────────────────────────
  {
    t: 64, nodeId: 'w-11', podName: 'vault-0',
    status: 'failed', cpuPct: 0.00, memPct: 0.05,
    severity: 'critical',
    message: 'VESSEL node-infra-01 — vault-0 DESTROYED — ALL SECRETS COMPROMISED',
  },
  {
    t: 70, nodeId: 'w-11',
    nodeReady: false, cpuPct: 0.18, memPct: 0.95,
    severity: 'critical',
    message: 'MAYDAY — node-infra-01 OFFLINE — security layer DOWN',
  },

  // ── Phase 5 : Recovery ───────────────────────────────────────────────────
  {
    t: 82, nodeId: 'w-11', podName: 'vault-0',
    status: 'pending', cpuPct: 0.00, memPct: 0.05,
    severity: 'info',
    message: 'RECOVERY — vault-0 restarting on node-infra-01…',
  },
  {
    t: 86, nodeId: 'w-11',
    nodeReady: true, cpuPct: 0.18, memPct: 0.32,
    severity: 'resolved',
    message: 'SIGNAL — node-infra-01 back online — security layer restoring',
  },
  {
    t: 90, nodeId: 'w-11', podName: 'vault-0',
    status: 'running', cpuPct: 0.03, memPct: 0.08,
    severity: 'resolved',
    message: 'SIGNAL — vault-0 operational — secrets layer secured',
  },
  {
    t: 94, nodeId: 'w-11', podName: 'external-secrets-5k2p',
    status: 'running', cpuPct: 0.01, memPct: 0.03,
    severity: 'resolved',
    message: 'SIGNAL — external-secrets-5k2p stabilised',
  },
  {
    t: 98, nodeId: 'w-4', podName: 'refund-worker-1c5v',
    status: 'pending', cpuPct: 0.00, memPct: 0.02,
    severity: 'info',
    message: 'RECOVERY — refund-worker-1c5v restarting on node-payments-02…',
  },
  {
    t: 102, nodeId: 'w-4', podName: 'refund-worker-1c5v',
    status: 'running', cpuPct: 0.04, memPct: 0.05,
    severity: 'resolved',
    message: 'SIGNAL — refund-worker-1c5v online — payments fully operational',
  },
  {
    t: 106, nodeId: 'w-8', podName: 'model-serving-5v1k',
    status: 'pending', cpuPct: 0.00, memPct: 0.02,
    severity: 'info',
    message: 'RECOVERY — model-serving-5v1k restarting — ML systems coming back…',
  },
  {
    t: 108, nodeId: 'w-2', podName: 'invoice-generator-5k1z',
    status: 'running', cpuPct: 0.04, memPct: 0.06,
    severity: 'resolved',
    message: 'SIGNAL — invoice-generator-5k1z back online',
  },
  {
    t: 111, nodeId: 'w-7', podName: 'feature-store-2k8p',
    status: 'running', cpuPct: 0.06, memPct: 0.08,
    severity: 'resolved',
    message: 'SIGNAL — feature-store-2k8p restored — reco-01 nominal',
  },
  {
    t: 114, nodeId: 'w-7',
    cpuPct: 0.60, memPct: 0.65,
    severity: 'info',
    message: 'VESSEL node-reco-01 — systems cooling down, CPU 60%',
  },
  {
    t: 118, nodeId: 'w-8', podName: 'model-serving-5v1k',
    status: 'running', cpuPct: 0.22, memPct: 0.18,
    severity: 'resolved',
    message: 'SIGNAL — model-serving-5v1k operational — ALL SYSTEMS GO',
  },
]

const CYCLE = 130  // seconds

// ── Cluster mutation — structural sharing ─────────────────────────────────────
// Only the mutated node/pod gets a new reference.
// Unchanged nodes keep the same reference so React.memo bails out on their Ships.

function applyEntry(cluster: Cluster, entry: ScriptEntry): Cluster {
  const nodeIdx = cluster.nodes.findIndex(n => n.id === entry.nodeId)
  if (nodeIdx === -1) return cluster

  const oldNode = cluster.nodes[nodeIdx]
  let newNode: typeof oldNode = { ...oldNode }

  if (entry.nodeReady !== undefined) newNode.ready = entry.nodeReady

  if (entry.addPod) {
    newNode.pods = [...oldNode.pods, entry.addPod]
  } else if (entry.removePod && entry.podName) {
    newNode.pods = oldNode.pods.filter(p => p.name !== entry.podName)
  } else if (!entry.podName) {
    if (entry.cpuPct !== undefined) newNode.cpuPct = entry.cpuPct
    if (entry.memPct !== undefined) newNode.memPct = entry.memPct
  } else {
    const podIdx = oldNode.pods.findIndex(p => p.name === entry.podName)
    if (podIdx !== -1) {
      const oldPod = oldNode.pods[podIdx]
      const newPod = { ...oldPod }
      if (entry.status !== undefined) newPod.status = entry.status
      if (entry.cpuPct !== undefined) newPod.cpuPct = entry.cpuPct
      if (entry.memPct !== undefined) newPod.memPct = entry.memPct
      newNode.pods = [
        ...oldNode.pods.slice(0, podIdx),
        newPod,
        ...oldNode.pods.slice(podIdx + 1),
      ]
    }
  }

  const newNodes = [...cluster.nodes]
  newNodes[nodeIdx] = newNode
  return { ...cluster, nodes: newNodes }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

const BASE = makeBaseline()

export function useSimulatedCluster() {
  const [cluster, setCluster]   = useState<Cluster>(BASE)
  const [events,  setEvents]    = useState<SimEvent[]>([])

  const startRef    = useRef<number>(Date.now())
  const appliedRef  = useRef<Set<number>>(new Set())
  const clusterRef  = useRef<Cluster>(BASE)

  useEffect(() => {
    startRef.current   = Date.now()
    appliedRef.current = new Set()
    clusterRef.current = BASE
    setCluster(BASE)
    setEvents([])

    const tick = setInterval(() => {
      const elapsed = ((Date.now() - startRef.current) / 1000) % CYCLE

      // Reset at cycle boundary
      if (elapsed < 1 && appliedRef.current.size > 0) {
        appliedRef.current = new Set()
        clusterRef.current = BASE
        setCluster(BASE)
        setEvents([])
        return
      }

      let changed = false
      for (const entry of SCRIPT) {
        if (elapsed >= entry.t && !appliedRef.current.has(entry.t)) {
          appliedRef.current.add(entry.t)
          clusterRef.current = applyEntry(clusterRef.current, entry)
          const ev: SimEvent = {
            id:       `${entry.t}-${entry.nodeId}`,
            t:        elapsed,
            severity: entry.severity,
            message:  entry.message,
          }
          setEvents(prev => [ev, ...prev].slice(0, 20))
          changed = true
        }
      }
      if (changed) setCluster(clusterRef.current)
    }, 1000)

    return () => clearInterval(tick)
  }, [])

  return { cluster, events }
}
