import { createServer }  from 'http'
import { execFileSync }  from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'

// Set KUBENOVA_CONTEXT to a kubeconfig context name for local use.
// Leave empty (default) when running in-cluster — kubectl will use the service account.
let CONTEXT    = process.env.KUBENOVA_CONTEXT ?? ''
const PORT       = Number(process.env.PORT) || 3001
const AGENT_NS   = 'kube-system'
const AGENT_PORT = 7777

// ── kubectl helpers ────────────────────────────────────────────────────────────
// execFileSync (not execSync) — args are passed as an array, never through a
// shell. This eliminates shell injection regardless of what values they contain.

function kubectl(...args) {
  const ctxArgs = CONTEXT ? [`--context=${CONTEXT}`] : []
  return JSON.parse(
    execFileSync('kubectl', [...ctxArgs, ...args, '-o', 'json'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  )
}

// Hit a pod's HTTP endpoint through the kube-apiserver proxy — no port-forward needed.
function kubectlProxy(podName, path) {
  const ctxArgs = CONTEXT ? [`--context=${CONTEXT}`] : []
  const raw = execFileSync(
    'kubectl',
    [...ctxArgs, 'get', '--raw', `/api/v1/namespaces/${AGENT_NS}/pods/${podName}:${AGENT_PORT}/proxy${path}`],
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
const WARN_REASONS     = new Set(['Killing', 'Failed', 'Unhealthy', 'FailedMount'])
const RESOLVED_REASONS = new Set(['Pulled', 'Started', 'Created', 'NodeReady'])

function eventSeverity(ev) {
  if (ev.type === 'Warning') {
    return CRITICAL_REASONS.has(ev.reason) ? 'critical' : 'warn'
  }
  if (WARN_REASONS.has(ev.reason)) return 'warn'
  return RESOLVED_REASONS.has(ev.reason) ? 'resolved' : 'info'
}

// ── eBPF agent state ──────────────────────────────────────────────────────────
// When an eBPF DaemonSet is running, flows and pod metrics come from it.
// Falls back to kubectl-top metrics when the agent is absent.

let ebpfFlows    = []
let podMetricsMap = new Map()  // "pod-name/namespace" → { cpuPct, memPct }

// Discover running ebpf-agent pod names
function getAgentPods() {
  try {
    const list = kubectl('get', 'pods', '-n', AGENT_NS, '-l', 'app=ebpf-agent')
    return list.items
      .filter(p => p.status?.phase === 'Running')
      .map(p => p.metadata.name)
  } catch {
    return []
  }
}

// Pull metrics from all eBPF agent pods and merge
function pullEbpfMetrics() {
  const agentPods = getAgentPods()
  if (agentPods.length === 0) return

  const allFlows   = []
  const newMetrics = new Map()

  for (const podName of agentPods) {
    try {
      const snap = kubectlProxy(podName, '/metrics')
      for (const flow of (snap.flows ?? [])) allFlows.push(flow)
      for (const pm of (snap.podMetrics ?? []))
        newMetrics.set(`${pm.pod}/${pm.ns}`, { cpuPct: pm.cpuPct, memPct: pm.memPct })
    } catch (err) {
      console.warn(`[ebpf-agent] failed to pull from ${podName}: ${err.message}`)
    }
  }

  ebpfFlows    = allFlows
  podMetricsMap = newMetrics
}

// ── kubectl top metrics (real CPU/mem without eBPF agent) ─────────────────────
// Parses `kubectl top pods -A --no-headers` output.
// Format: NAMESPACE  NAME  CPU(cores)  MEMORY(bytes)
// Node limits come from the node allocatable capacity.

let nodeAllocatable = new Map()  // nodeName → { cpuMillis, memBytes }

function pullKubectlTopMetrics() {
  // Skip if eBPF agent already provides metrics
  if (podMetricsMap.size > 0) return

  try {
    // Refresh node allocatable (cheap, cached across calls)
    if (nodeAllocatable.size === 0) {
      const nodes = kubectl('get', 'nodes')
      for (const n of nodes.items) {
        const cpu = parseCpuToMillis(n.status?.allocatable?.cpu ?? '1000m')
        const mem = parseMemToBytes(n.status?.allocatable?.memory ?? '1Gi')
        nodeAllocatable.set(n.metadata.name, { cpuMillis: cpu, memBytes: mem })
      }
    }

    const ctxArgs = CONTEXT ? [`--context=${CONTEXT}`] : []
    const raw = execFileSync(
      'kubectl',
      [...ctxArgs, 'top', 'pods', '-A', '--no-headers'],
      { encoding: 'utf8', timeout: 10000 }
    )

    // Average allocatable across all nodes as denominator
    let totalCpu = 0, totalMem = 0, count = 0
    for (const { cpuMillis, memBytes } of nodeAllocatable.values()) {
      totalCpu += cpuMillis; totalMem += memBytes; count++
    }
    const avgCpuMillis = count ? totalCpu / count : 1000
    const avgMemBytes  = count ? totalMem / count : 1_073_741_824

    const newMetrics = new Map()
    for (const line of raw.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 4) continue
      const [ns, name, cpuRaw, memRaw] = parts
      const cpuMillis = parseCpuToMillis(cpuRaw)
      const memBytes  = parseMemToBytes(memRaw)
      newMetrics.set(`${name}/${ns}`, {
        cpuPct: Math.min(0.99, cpuMillis / avgCpuMillis),
        memPct: Math.min(0.99, memBytes  / avgMemBytes),
      })
    }
    if (newMetrics.size > 0) podMetricsMap = newMetrics
  } catch (err) {
    // Metrics Server not installed or not ready — silently keep fallback
    if (!err.message?.includes('Metrics API not available')) {
      console.warn('[metrics] kubectl top error:', err.message)
    }
  }
}

function parseCpuToMillis(s) {
  if (!s) return 0
  if (s.endsWith('m')) return parseInt(s, 10)
  return Math.round(parseFloat(s) * 1000)
}

function parseMemToBytes(s) {
  if (!s) return 0
  const units = { Ki: 1024, Mi: 1024**2, Gi: 1024**3, Ti: 1024**4, k: 1000, M: 1000**2, G: 1000**3 }
  for (const [suffix, mult] of Object.entries(units)) {
    if (s.endsWith(suffix)) return parseInt(s, 10) * mult
  }
  return parseInt(s, 10)
}

// ── Fallback metrics (used when neither eBPF agent nor Metrics Server is available) ──

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
  const nodeList = kubectl('get', 'nodes')
  const podList  = kubectl('get', 'pods', '-A')

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

  return { name: CONTEXT || 'in-cluster', nodes, flows: ebpfFlows }
}

function buildEvents() {
  try {
    const evList = kubectl('get', 'events', '-A', '--sort-by=.lastTimestamp')
    const events = evList.items
      .slice(-40).reverse()
      .filter(ev => ev.type === 'Warning' || RESOLVED_REASONS.has(ev.reason) || WARN_REASONS.has(ev.reason))
      .slice(0, 18)
      .map(ev => ({
        id:       ev.metadata.uid,
        severity: eventSeverity(ev),
        message:  `${ev.involvedObject?.name ?? '?'} — ${ev.message ?? ev.reason}`.replace(/[\x00-\x1f\x7f]/g, ' ').trim(),
      }))

    // Scan pods for OOMKilled containers — K8s doesn't emit OOMKilling events
    // for cgroup-level OOM kills, so we synthesize from pod container state.
    // restartPolicy:Never pods put OOMKill in state.terminated (not lastState).
    try {
      const podList = kubectl('get', 'pods', '-A')
      for (const pod of (podList.items ?? [])) {
        for (const cs of (pod.status?.containerStatuses ?? [])) {
          const cur  = cs.state?.terminated
          const last = cs.lastState?.terminated
          const oom  = (cur?.reason === 'OOMKilled') ? cur : (last?.reason === 'OOMKilled') ? last : null
          if (oom) {
            events.unshift({
              id:       `oom-${pod.metadata.namespace}-${pod.metadata.name}-${cs.name}`,
              severity: 'critical',
              message:  `${pod.metadata.name} — OOMKilled (container ${cs.name}, exit 137)`,
            })
          }
        }
      }
    } catch {}

    return events.slice(0, 20)
  } catch {
    return []
  }
}

// ── Cache / snapshot ──────────────────────────────────────────────────────────

const TOPO_TTL_MS  = 30_000

let cachedCluster = null
let cachedEvents  = null
let topoAt        = 0

let lastError = null

function getSnapshot() {
  const now = Date.now()

  if (!cachedCluster || now - topoAt > TOPO_TTL_MS) {
    try {
      cachedCluster = buildCluster()
      cachedEvents  = buildEvents()
      lastError     = null
      topoAt = now
    } catch (err) {
      console.error('[k8s-server] topology error:', err.message)
      lastError = err.message
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

  return { cluster: cachedCluster, events: cachedEvents, error: lastError }
}

// ── Context helpers ───────────────────────────────────────────────────────────

function listContexts() {
  try {
    const raw = execFileSync('kubectl', ['config', 'get-contexts', '-o', 'name'], {
      encoding: 'utf8', timeout: 5000,
    })
    return raw.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function currentKubectlContext() {
  try {
    return execFileSync('kubectl', ['config', 'current-context'], {
      encoding: 'utf8', timeout: 3000,
    }).trim()
  } catch {
    return ''
  }
}

function switchContext(name) {
  const valid = listContexts()
  if (!valid.includes(name)) throw new Error(`Unknown context: ${name}`)
  CONTEXT = name
  cachedCluster = null
  cachedEvents  = null
  topoAt = 0
  console.log(`[k8s-server] switched to context: ${name}`)
}

// ── HTTP + WebSocket ──────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

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

  if (req.method === 'GET' && req.url === '/api/contexts') {
    const contexts = listContexts()
    const active   = CONTEXT || currentKubectlContext()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ contexts, active }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/context') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { context } = JSON.parse(body)
        switchContext(context)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, context }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
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

// Metrics pull loop — every 15s (matches Metrics Server resolution)
// Prefers eBPF agent; falls back to kubectl top automatically.
const METRICS_PULL_MS = 15_000
setInterval(() => {
  try {
    pullEbpfMetrics()
    pullKubectlTopMetrics()
  } catch (err) {
    console.warn('[metrics] pull error:', err.message)
  }
}, METRICS_PULL_MS)

// Initial pull on startup so first snapshot has real data
pullKubectlTopMetrics()

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
