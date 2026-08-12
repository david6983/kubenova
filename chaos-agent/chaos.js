const { exec } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(exec)

const SCALABLE_DEPLOYMENTS = [
  { name: 'order-worker',    namespace: 'production' },
  { name: 'fraud-detector',  namespace: 'payments' },
  { name: 'reco-engine',     namespace: 'ml' },
  { name: 'fulfillment-svc', namespace: 'production' },
]

const HTTP_TARGETS = [
  { name: 'shop-api',        namespace: 'production' },
  { name: 'payment-service', namespace: 'payments' },
  { name: 'search-api',      namespace: 'search' },
  { name: 'grafana',         namespace: 'monitoring' },
]

// ── Async kubectl ──────────────────────────────────────────────────────────────

async function kubectl(cmd) {
  try {
    const { stdout } = await execAsync(
      `kubectl --context=kind-shopnova-prod ${cmd}`,
      { timeout: 8000 }
    )
    return stdout.trim()
  } catch {
    return null
  }
}

// ── Actions ────────────────────────────────────────────────────────────────────

async function getRandomPausePods() {
  const out = await kubectl(
    `get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}/{.spec.containers[0].image}\\n{end}'`
  )
  if (!out) return []
  return out
    .split('\n')
    .filter(line => line.includes('pause'))
    .map(line => {
      const [namespace, name] = line.split('/')
      return { namespace, name }
    })
    .filter(p => p.name && p.namespace)
}

const clusterIPCache = {}

async function getServiceClusterIP(name, namespace) {
  const key = `${namespace}/${name}`
  if (clusterIPCache[key]) return clusterIPCache[key]
  const ip = await kubectl(`get svc ${name} -n ${namespace} -o jsonpath='{.spec.clusterIP}'`)
  if (ip && ip !== 'None') clusterIPCache[key] = ip
  return ip
}

async function killPod(pod) {
  const result = await kubectl(`delete pod ${pod.name} -n ${pod.namespace} --grace-period=0`)
  console.log(`[chaos] killed ${pod.namespace}/${pod.name}: ${result !== null ? 'ok' : 'failed'}`)
  return result !== null
}

async function scaleDeployment(dep, replicas) {
  const result = await kubectl(`scale deployment ${dep.name} -n ${dep.namespace} --replicas=${replicas}`)
  console.log(`[chaos] scale ${dep.namespace}/${dep.name} → ${replicas}: ${result !== null ? 'ok' : 'failed'}`)
  return result !== null
}

async function curlTarget(target) {
  const ip = await getServiceClusterIP(target.name, target.namespace)
  if (!ip || ip === 'None') return false
  try {
    await execAsync(`curl -sf --max-time 2 http://${ip}/`, { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

// NOTE: trafficLevel is accepted by the API but the curl loop is disabled —
// ClusterIPs are not reachable from outside the cluster (Docker Desktop).
// Traffic is visualised in the KubeNova UI via the frontend slider only.
let state = { trafficLevel: 0, chaosLevel: 0, podKillsTotal: 0, curlsTotal: 0 }
let chaosTimer = null

// ── Chaos loop ─────────────────────────────────────────────────────────────────

let chaosRunning = false
const CHAOS_INTERVALS = [0, 120000, 60000, 30000]

function startChaosLoop(level) {
  chaosRunning = false
  if (chaosTimer) { clearTimeout(chaosTimer); chaosTimer = null }
  if (level <= 0) return

  const intervalMs = CHAOS_INTERVALS[level]
  chaosRunning = true

  async function tick() {
    if (!chaosRunning) return

    const pods = await getRandomPausePods()
    if (pods.length) {
      const killCount = level >= 2 ? 2 : 1
      const victims = pods.sort(() => Math.random() - 0.5).slice(0, killCount)
      for (const pod of victims) {
        if (await killPod(pod)) state.podKillsTotal++
      }

      if (level >= 3) {
        const dep = SCALABLE_DEPLOYMENTS[Math.floor(Math.random() * SCALABLE_DEPLOYMENTS.length)]
        if (await scaleDeployment(dep, 0)) {
          setTimeout(() => scaleDeployment(dep, 1), 20000)
        }
      }
    }

    if (chaosRunning) chaosTimer = setTimeout(tick, intervalMs)
  }

  chaosTimer = setTimeout(tick, intervalMs)
}

// ── Public API ─────────────────────────────────────────────────────────────────

function applyConfig({ trafficLevel, chaosLevel }) {
  if (trafficLevel !== undefined) {
    state.trafficLevel = Math.max(0, Math.min(100, trafficLevel))
  }
  if (chaosLevel !== undefined && chaosLevel !== state.chaosLevel) {
    state.chaosLevel = Math.max(0, Math.min(3, chaosLevel))
    startChaosLoop(state.chaosLevel)
    console.log(`[chaos] chaos → level ${state.chaosLevel}`)
  }
}

function getStatus() {
  return { ...state }
}

module.exports = { applyConfig, getStatus }
