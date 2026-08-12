import { createServer }  from 'http'
import { execSync }      from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'

const CONTEXT    = 'kind-shopnova-prod'
const PORT       = 3001
const AGENT_NS   = 'kube-system'
const AGENT_PORT = 7777

// ── kubectl helpers ────────────────────────────────────────────────────────────

function kubectl(cmd) {
  return JSON.parse(
    execSync(`kubectl --context=${CONTEXT} ${cmd} -o json`, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  )
}

// Hit a pod's HTTP endpoint through the kube-apiserver proxy — no port-forward needed.
function kubectlProxy(podName, path) {
  const raw = execSync(
    `kubectl --context=${CONTEXT} get --raw "/api/v1/namespaces/${AGENT_NS}/pods/${podName}:${AGENT_PORT}/proxy${path}"`,
    { encoding: 'utf8', timeout: 5000 }
  )
  return JSON.parse(raw)
}

// ── Workload / status helpers ─────────────────────────────────────────────────

function workloadKind(pod) {
  const owner = pod.metadata?.ownerReferences?.[0]
  if (!owner) return 'other'
  switch (owner.kind) {
    case 'ReplicaSet':  return 'deployment'
    case 'StatefulSet': return 'statefulset'
    case 'DaemonSet':   return 'daemonset'
    case 'Job':         return 'cronjob'
    default:            return 'other'
  }
}

function podStatus(pod) {
  const cs = pod.status?.containerStatuses ?? []
  if (cs.some(c => c.state?.waiting?.reason === 'CrashLoopBackOff')) return 'crashloop'
  switch (pod.status?.phase) {
    case 'Running':   return 'running'
    case 'Pending':   return 'pending'
    case 'Failed':    return 'failed'
    case 'Succeeded': return 'running'
    default:          return 'failed'
  }
}

const CRITICAL_REASONS = new Set(['BackOff', 'OOMKilling', 'Evicted', 'NodeNotReady'])
const RESOLVED_REASONS = new Set(['Pulled', 'Started', 'Created', 'NodeReady'])

function eventSeverity(ev) {
  if (ev.type === 'Warning') {
    return CRITICAL_REASONS.has(ev.reason) ? 'critical' : 'warn'
  }
  return RESOLVED_REASONS.has(ev.reason) ? 'resolved' : 'info'
}

// ── eBPF agent state ──────────────────────────────────────────────────────────
// Collected from all per-node ebpf-agent pods every 2s.
// podMetricsMap: "pod-name/namespace" → { cpuPct, memPct }

let ebpfFlows    = []
let podMetricsMap = new Map()

// Discover running ebpf-agent pod names
function getAgentPods() {
  try {
    const list = kubectl(`get pods -n ${AGENT_NS} -l app=ebpf-agent`)
    return list.items
      .filter(p => p.status?.phase === 'Running')
      .map(p => p.metadata.name)
  } catch {
    return []
  }
}

// Pull metrics from all agent pods and merge
function pullEbpfMetrics() {
  const agentPods = getAgentPods()
  if (agentPods.length === 0) return

  const allFlows   = []
  const newMetrics = new Map()

  for (const podName of agentPods) {
    try {
      const snap = kubectlProxy(podName, '/metrics')

      for (const flow of (snap.flows ?? [])) {
        allFlows.push(flow)
      }
      for (const pm of (snap.podMetrics ?? [])) {
        newMetrics.set(`${pm.pod}/${pm.ns}`, { cpuPct: pm.cpuPct, memPct: pm.memPct })
      }
    } catch (err) {
      console.warn(`[ebpf-agent] failed to pull from ${podName}: ${err.message}`)
    }
  }

  ebpfFlows    = allFlows
  podMetricsMap = newMetrics
}

// ── Fallback metrics (used before eBPF agent has data for a pod) ──────────────

function stableBase(name, salt) {
  let h = salt
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0
  return ((h >>> 0) % 10000) / 10000
}

const KIND_BASE = {
  cpu: { deployment: 0.38, statefulset: 0.55, daemonset: 0.12, cronjob: 0.22, other: 0.28 },
  mem: { deployment: 0.48, statefulset: 0.65, daemonset: 0.18, cronjob: 0.28, other: 0.33 },
}

function fallbackMetric(kind, name, salt) {
  const base   = KIND_BASE[salt === 1 ? 'cpu' : 'mem'][kind] ?? 0.3
  const jitter = (stableBase(name, salt) - 0.5) * 0.10
  return Math.max(0.02, Math.min(0.97, base + jitter))
}

function resolveMetrics(podName, namespace, kind) {
  const real = podMetricsMap.get(`${podName}/${namespace}`)
  if (real) return real
  return {
    cpuPct: fallbackMetric(kind, podName, 1),
    memPct: fallbackMetric(kind, podName, 2),
  }
}

// ── Build cluster topology + merge eBPF metrics ───────────────────────────────

function buildCluster() {
  const nodeList = kubectl('get nodes')
  const podList  = kubectl('get pods -A')

  const podsByNode = {}
  for (const pod of podList.items) {
    const n = pod.spec?.nodeName
    if (n) (podsByNode[n] ??= []).push(pod)
  }

  const nodes = nodeList.items.map(node => {
    const name  = node.metadata.name
    const isCP  = Object.keys(node.metadata?.labels ?? {})
      .some(k => k.startsWith('node-role.kubernetes.io/control-plane'))
    const ready = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True'

    const pods = (podsByNode[name] ?? []).map(pod => {
      const kind    = workloadKind(pod)
      const metrics = resolveMetrics(pod.metadata.name, pod.metadata.namespace, kind)
      return {
        id:           pod.metadata.uid,
        name:         pod.metadata.name,
        namespace:    pod.metadata.namespace,
        status:       podStatus(pod),
        cpuPct:       metrics.cpuPct,
        memPct:       metrics.memPct,
        workloadKind: kind,
      }
    })

    const avgCpu = pods.length ? pods.reduce((s, p) => s + p.cpuPct, 0) / pods.length : 0.15
    const avgMem = pods.length ? pods.reduce((s, p) => s + p.memPct, 0) / pods.length : 0.20

    return { id: name, name, role: isCP ? 'control-plane' : 'worker', cpuPct: avgCpu, memPct: avgMem, ready, pods }
  })

  return { name: 'shopnova-prod', nodes, flows: ebpfFlows }
}

function buildEvents() {
  try {
    const evList = kubectl('get events -A --sort-by=.lastTimestamp')
    return evList.items
      .slice(-30).reverse()
      .filter(ev => ev.type === 'Warning' || RESOLVED_REASONS.has(ev.reason))
      .slice(0, 20)
      .map(ev => ({
        id:       ev.metadata.uid,
        severity: eventSeverity(ev),
        message:  `${ev.involvedObject?.name ?? '?'} — ${ev.message ?? ev.reason}`,
      }))
  } catch {
    return []
  }
}

// ── Cache / snapshot ──────────────────────────────────────────────────────────

const TOPO_TTL_MS  = 30_000
const EBPF_PULL_MS =  2_000

let cachedCluster = null
let cachedEvents  = null
let topoAt        = 0

function getSnapshot() {
  const now = Date.now()

  if (!cachedCluster || now - topoAt > TOPO_TTL_MS) {
    try {
      cachedCluster = buildCluster()
      cachedEvents  = buildEvents()
      topoAt = now
    } catch (err) {
      console.error('[k8s-server] topology error:', err.message)
    }
  } else {
    // Merge latest eBPF metrics without hitting kubectl
    if (cachedCluster) {
      cachedCluster = {
        ...cachedCluster,
        flows: ebpfFlows,
        nodes: cachedCluster.nodes.map(node => {
          const pods = node.pods.map(pod => {
            const m = resolveMetrics(pod.name, pod.namespace, pod.workloadKind)
            return { ...pod, cpuPct: m.cpuPct, memPct: m.memPct }
          })
          const avgCpu = pods.length ? pods.reduce((s, p) => s + p.cpuPct, 0) / pods.length : 0.15
          const avgMem = pods.length ? pods.reduce((s, p) => s + p.memPct, 0) / pods.length : 0.20
          return { ...node, cpuPct: avgCpu, memPct: avgMem, pods }
        }),
      }
    }
  }

  return { cluster: cachedCluster, events: cachedEvents }
}

// ── HTTP + WebSocket ──────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method === 'GET' && req.url === '/api/cluster') {
    try {
      const { cluster, events } = getSnapshot()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ cluster, events }))
    } catch (err) {
      console.error('[k8s-server] REST error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', ws => {
  try {
    const { cluster, events } = getSnapshot()
    ws.send(JSON.stringify({ cluster, events }))
  } catch (err) {
    console.warn('[ws] initial send error:', err.message)
  }
})

// eBPF pull loop — every 2s
setInterval(() => {
  try {
    pullEbpfMetrics()
  } catch (err) {
    console.warn('[ebpf] pull error:', err.message)
  }
}, EBPF_PULL_MS)

// Broadcast to UI — every 2s
setInterval(() => {
  if (wss.clients.size === 0) return
  try {
    const { cluster, events } = getSnapshot()
    const payload = JSON.stringify({ cluster, events })
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    }
  } catch (err) {
    console.error('[ws] broadcast error:', err.message)
  }
}, 2000)

httpServer.listen(PORT, () => {
  console.log(`[k8s-server] HTTP + WebSocket on :${PORT}`)
  console.log(`[k8s-server] kubectl context: ${CONTEXT}`)
  console.log(`[k8s-server] eBPF agents queried via kube-apiserver proxy — no external deps`)
})
