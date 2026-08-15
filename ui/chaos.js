// chaos.js — KubeNova chaos engine
// Listens on :9666. UI sends { trafficLevel: 0-100, chaosLevel: 0|1|3 }.
// Applies real Kubernetes traffic load and chaos to the live cluster.

import { createServer } from 'http'
import { execFileSync }  from 'child_process'

const PORT    = Number(process.env.CHAOS_PORT) || 9666
const CONTEXT = process.env.KUBENOVA_CONTEXT ?? ''

let cfg        = { trafficLevel: 0, chaosLevel: 0 }
let chaosTimer = null

// ── kubectl helpers ────────────────────────────────────────────────────────────

function kubectl(...args) {
  const ctx = CONTEXT ? [`--context=${CONTEXT}`] : []
  return execFileSync('kubectl', [...ctx, ...args, '--request-timeout=10s'], {
    encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function kubectlApply(yaml) {
  const ctx = CONTEXT ? [`--context=${CONTEXT}`] : []
  return execFileSync('kubectl', [...ctx, 'apply', '-f', '-', '--request-timeout=10s'], {
    input: yaml, encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// ── Traffic generator ──────────────────────────────────────────────────────────
// Uses nginx:alpine (already in KinD — no image pull delay).
// BusyBox wget is bundled in alpine, so no apk install needed.
// Hits api + worker Services in `app` ns, and TCP-pings postgres + redis in `data` ns.
// These flows are captured by the eBPF TC hooks and appear in the 3D visualization.

function trafficManifest(replicas) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: traffic-gen
  namespace: app
  labels:
    app: traffic-gen
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: traffic-gen
  template:
    metadata:
      labels:
        app: traffic-gen
    spec:
      terminationGracePeriodSeconds: 1
      containers:
      - name: gen
        image: nginx:alpine
        imagePullPolicy: IfNotPresent
        command: ["/bin/sh", "-c"]
        args:
        - |
          while true; do
            wget -qO- http://api.app.svc.cluster.local/ > /dev/null 2>&1 || true
            wget -qO- http://worker.app.svc.cluster.local/ > /dev/null 2>&1 || true
            nc -zw1 postgres.data.svc.cluster.local 5432 2>/dev/null || true
            nc -zw1 redis.data.svc.cluster.local 6379 2>/dev/null || true
            sleep 0.2
          done
        resources:
          requests:
            cpu: "5m"
            memory: "8Mi"
          limits:
            cpu: "30m"
            memory: "16Mi"
`
}

function applyTraffic() {
  const { trafficLevel } = cfg
  if (trafficLevel < 5) {
    try { kubectl('delete', 'deployment', 'traffic-gen', '-n', 'app', '--ignore-not-found') } catch {}
    return
  }
  const replicas = Math.min(4, Math.max(1, Math.round(trafficLevel / 25)))
  try {
    kubectlApply(trafficManifest(replicas))
    console.log(`[chaos] traffic-gen: ${replicas} replicas (trafficLevel=${cfg.trafficLevel})`)
  } catch (e) {
    console.warn('[chaos] traffic apply error:', e.message?.split('\n')[0])
  }
}

// ── Pod chaos ──────────────────────────────────────────────────────────────────

function killablePods() {
  try {
    const raw  = kubectl('get', 'pods', '-n', 'app', '-o', 'json')
    return JSON.parse(raw).items
      .filter(p => p.status?.phase === 'Running' && !p.metadata.name.startsWith('traffic-gen') && !p.metadata.name.startsWith('oom-'))
      .map(p => p.metadata.name)
  } catch { return [] }
}

function killRandomPod() {
  const pods = killablePods()
  if (!pods.length) return
  const target = pods[Math.floor(Math.random() * pods.length)]
  try {
    kubectl('delete', 'pod', target, '-n', 'app', '--grace-period=1')
    console.log('[chaos] killed', target)
  } catch (e) {
    console.warn('[chaos] kill error:', e.message?.split('\n')[0])
  }
}

// OOMKill: pod with 16Mi memory limit that fills /tmp (tmpfs → RAM).
// K8s creates an OOMKilling Warning event that appears in the ops log.
function triggerOOMKill() {
  const name = `oom-${Date.now() % 100000}`
  const manifest = `apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  namespace: app
  labels:
    chaos: oom
spec:
  restartPolicy: Never
  terminationGracePeriodSeconds: 0
  containers:
  - name: hog
    image: nginx:alpine
    imagePullPolicy: IfNotPresent
    command: ["/bin/sh", "-c", "dd if=/dev/zero of=/dev/shm/fill bs=1M"]
    resources:
      limits:
        memory: "16Mi"
        cpu: "50m"
`
  try {
    kubectlApply(manifest)
    console.log('[chaos] OOM pod:', name)
  } catch (e) {
    console.warn('[chaos] OOM error:', e.message?.split('\n')[0])
  }
}

// ── Chaos scheduler ────────────────────────────────────────────────────────────

function rescheduleChaos() {
  if (chaosTimer) { clearInterval(chaosTimer); chaosTimer = null }
  if (cfg.chaosLevel === 0) return

  const ms = cfg.chaosLevel >= 3 ? 15_000 : 40_000
  chaosTimer = setInterval(() => {
    try { killRandomPod() } catch {}
    if (cfg.chaosLevel >= 3 && Math.random() < 0.5) {
      try { triggerOOMKill() } catch {}
    }
  }, ms)
}

function applyConfig() {
  try { applyTraffic()      } catch {}
  rescheduleChaos()
}

// ── HTTP server ────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'POST' && req.url === '/config') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { trafficLevel, chaosLevel } = JSON.parse(body)
        if (typeof trafficLevel === 'number') cfg.trafficLevel = trafficLevel
        if (typeof chaosLevel   === 'number') cfg.chaosLevel   = chaosLevel
        console.log(`[chaos] config: trafficLevel=${cfg.trafficLevel} chaosLevel=${cfg.chaosLevel}`)
        applyConfig()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, cfg }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, cfg }))
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, () => {
  console.log(`[chaos] engine on :${PORT}`)
  console.log(`[chaos] kubectl context: ${CONTEXT}`)
})
