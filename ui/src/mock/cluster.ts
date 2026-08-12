import type { Cluster, Pod } from '../types'

function guessKind(name: string): Pod['workloadKind'] {
  if (/node-exporter-ds|fluentbit-ds|kube-proxy|falco-ds/.test(name)) return 'daemonset'
  if (/etcd-|postgres-|elasticsearch-|redis-|kafka-|prometheus-|alertmanager-|loki-|vault-|zookeeper-|typesense-|tempo-/.test(name)) return 'statefulset'
  return 'deployment'
}

function p(list: Array<{ name: string; ns: string; status: Pod['status']; cpu: number; mem: number }>): Pod[] {
  return list.map(p => ({
    id: `p-${Math.random().toString(36).slice(2)}`,
    name: p.name, namespace: p.ns, status: p.status, cpuPct: p.cpu, memPct: p.mem,
    workloadKind: guessKind(p.name),
  }))
}

// Generates N replicas of a deployment with random suffixes
function replicas(
  base: string, ns: string, n: number,
  cpuBase: number, memBase: number,
  statusOverride?: (i: number) => Pod['status'],
): Array<{ name: string; ns: string; status: Pod['status']; cpu: number; mem: number }> {
  const sfx = ['x2k','m3n','p7r','z9q','k4w','v8n','t5c','q2f','r6h','b1d',
                'j9s','l4p','n7m','g3k','y5x','e8t','w2a','u6c','o1v','s4b',
                'f7g','h3j','d9e','i2w','c5r','a8m','k1n','m6p','t3q','v9x']
  return Array.from({ length: n }, (_, i) => ({
    name: `${base}-${sfx[i % sfx.length]}`,
    ns,
    status: statusOverride ? statusOverride(i) : 'running',
    cpu: Math.max(0.01, cpuBase + (Math.sin(i * 7.3) * 0.05)),
    mem: Math.max(0.01, memBase + (Math.cos(i * 4.1) * 0.04)),
  }))
}

export const mockCluster: Cluster = {
  name: 'shopnova-prod-eu-west-1',
  nodes: [
    // ── Control Plane HA ────────────────────────────────────────────────────────
    {
      id: 'cp-0', name: 'cp-master-01', role: 'control-plane',
      cpuPct: 0.22, memPct: 0.38, ready: true,
      pods: p([
        { name: 'kube-apiserver-01',          ns: 'kube-system', status: 'running', cpu: 0.14, mem: 0.28 },
        { name: 'etcd-01',                    ns: 'kube-system', status: 'running', cpu: 0.06, mem: 0.18 },
        { name: 'kube-scheduler-01',          ns: 'kube-system', status: 'running', cpu: 0.02, mem: 0.08 },
        { name: 'kube-controller-manager-01', ns: 'kube-system', status: 'running', cpu: 0.04, mem: 0.10 },
        { name: 'coredns-7d89-xk2p',          ns: 'kube-system', status: 'running', cpu: 0.01, mem: 0.04 },
        { name: 'coredns-7d89-m3nq',          ns: 'kube-system', status: 'running', cpu: 0.01, mem: 0.04 },
        { name: 'kube-proxy-ds-cp0',          ns: 'kube-system', status: 'running', cpu: 0.01, mem: 0.02 },
      ]),
    },
    {
      id: 'cp-1', name: 'cp-master-02', role: 'control-plane',
      cpuPct: 0.25, memPct: 0.40, ready: true,
      pods: p([
        { name: 'kube-apiserver-02',          ns: 'kube-system', status: 'running', cpu: 0.16, mem: 0.26 },
        { name: 'etcd-02',                    ns: 'kube-system', status: 'running', cpu: 0.07, mem: 0.20 },
        { name: 'kube-scheduler-02',          ns: 'kube-system', status: 'running', cpu: 0.02, mem: 0.07 },
        { name: 'metrics-server-6d94',        ns: 'kube-system', status: 'running', cpu: 0.02, mem: 0.05 },
        { name: 'cluster-autoscaler-8f7c',    ns: 'kube-system', status: 'running', cpu: 0.03, mem: 0.06 },
        { name: 'kube-proxy-ds-cp1',          ns: 'kube-system', status: 'running', cpu: 0.01, mem: 0.02 },
      ]),
    },
    {
      id: 'cp-2', name: 'cp-master-03', role: 'control-plane',
      cpuPct: 0.20, memPct: 0.35, ready: true,
      pods: p([
        { name: 'kube-apiserver-03',          ns: 'kube-system', status: 'running', cpu: 0.13, mem: 0.25 },
        { name: 'etcd-03',                    ns: 'kube-system', status: 'running', cpu: 0.05, mem: 0.17 },
        { name: 'kube-controller-manager-03', ns: 'kube-system', status: 'running', cpu: 0.03, mem: 0.09 },
        { name: 'coredns-7d89-m9wq',          ns: 'kube-system', status: 'running', cpu: 0.01, mem: 0.04 },
        { name: 'kube-proxy-ds-cp2',          ns: 'kube-system', status: 'running', cpu: 0.01, mem: 0.02 },
      ]),
    },

    // ── w-0  node-api-01 — 22 pods ──────────────────────────────────────────────
    {
      id: 'w-0', name: 'node-api-01', role: 'worker',
      cpuPct: 0.85, memPct: 0.78, ready: true,
      pods: p([
        ...replicas('shop-api-7f9d',     'production', 8, 0.10, 0.09),
        ...replicas('product-catalog-8m', 'production', 5, 0.06, 0.07),
        ...replicas('user-auth-6p3k',    'production', 4, 0.04, 0.05),
        ...replicas('gateway-ctrl-3n9q', 'gateway',    2, 0.03, 0.03),
        { name: 'node-exporter-ds-w0',   ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w0',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-1  node-api-02 — 20 pods ──────────────────────────────────────────────
    {
      id: 'w-1', name: 'node-api-02', role: 'worker',
      cpuPct: 0.80, memPct: 0.72, ready: true,
      pods: p([
        ...replicas('shop-api-7f9d',     'production', 7, 0.09, 0.08),
        ...replicas('cart-service-5n2p', 'production', 6, 0.07, 0.07),
        ...replicas('session-store-4m7', 'production', 3, 0.04, 0.05),
        ...replicas('rate-limiter-9k1w', 'gateway',    2, 0.03, 0.03),
        { name: 'node-exporter-ds-w1',  ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w1',      ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-2  node-api-03 — 18 pods ──────────────────────────────────────────────
    {
      id: 'w-2', name: 'node-api-03', role: 'worker',
      cpuPct: 0.74, memPct: 0.65, ready: true,
      pods: p([
        ...replicas('shop-api-7f9d',       'production', 6, 0.09, 0.08),
        ...replicas('wishlist-svc-2k9p',   'production', 4, 0.05, 0.06),
        ...replicas('notification-svc-7t', 'production', 4, 0.04, 0.05),
        ...replicas('email-worker-5p2x',   'production', 2, 0.03, 0.03),
        { name: 'node-exporter-ds-w2',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w2',        ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-3  node-api-04 — 16 pods ──────────────────────────────────────────────
    {
      id: 'w-3', name: 'node-api-04', role: 'worker',
      cpuPct: 0.65, memPct: 0.58, ready: true,
      pods: p([
        ...replicas('shop-api-7f9d',       'production', 5, 0.08, 0.07),
        ...replicas('request-mirror-6v',   'gateway',    3, 0.04, 0.04),
        ...replicas('sms-worker-8m4q',     'production', 3, 0.03, 0.04,
                    i => i === 0 ? 'pending' : 'running'),
        ...replicas('webhook-handler-3p',  'production', 3, 0.04, 0.05),
        { name: 'node-exporter-ds-w3',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w3',        ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-4  node-orders-01 — 18 pods ───────────────────────────────────────────
    {
      id: 'w-4', name: 'node-orders-01', role: 'worker',
      cpuPct: 0.68, memPct: 0.74, ready: true,
      pods: p([
        ...replicas('order-service-4t8p', 'production', 8, 0.08, 0.09),
        ...replicas('order-worker-7v2x',  'production', 4, 0.05, 0.06),
        ...replicas('fulfillment-svc-3n', 'production', 3, 0.04, 0.05),
        { name: 'invoice-generator-5k1z', ns: 'production', status: 'running', cpu: 0.05, mem: 0.06 },
        { name: 'node-exporter-ds-w4',   ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w4',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-5  node-orders-02 — 16 pods ───────────────────────────────────────────
    {
      id: 'w-5', name: 'node-orders-02', role: 'worker',
      cpuPct: 0.58, memPct: 0.66, ready: true,
      pods: p([
        ...replicas('order-service-4t8p', 'production', 6, 0.07, 0.08),
        ...replicas('return-handler-9q3', 'production', 4, 0.05, 0.06),
        ...replicas('tracking-svc-5v1k',  'production', 3, 0.04, 0.05),
        { name: 'shipping-connector-2p8', ns: 'production', status: 'running', cpu: 0.06, mem: 0.07 },
        { name: 'node-exporter-ds-w5',   ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w5',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-6  node-payments-01 — 17 pods ─────────────────────────────────────────
    {
      id: 'w-6', name: 'node-payments-01', role: 'worker',
      cpuPct: 0.52, memPct: 0.56, ready: true,
      pods: p([
        ...replicas('payment-service-2n9', 'payments', 6, 0.07, 0.08),
        ...replicas('fraud-detector-8q2w', 'payments', 4, 0.05, 0.05),
        ...replicas('subscription-svc-6m', 'payments', 3, 0.04, 0.05),
        { name: 'stripe-webhook-3p8x',    ns: 'payments',   status: 'running', cpu: 0.04, mem: 0.05 },
        { name: 'pci-audit-logger-4w2x',  ns: 'payments',   status: 'running', cpu: 0.04, mem: 0.05 },
        { name: 'node-exporter-ds-w6',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w6',        ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-7  node-payments-02 — 14 pods ─────────────────────────────────────────
    {
      id: 'w-7', name: 'node-payments-02', role: 'worker',
      cpuPct: 0.46, memPct: 0.50, ready: true,
      pods: p([
        ...replicas('payment-service-2n9', 'payments', 5, 0.06, 0.07),
        ...replicas('tax-calculator-2k8x', 'payments', 3, 0.03, 0.04),
        { name: 'billing-cron-9k4m',      ns: 'payments',   status: 'running',   cpu: 0.05, mem: 0.06 },
        { name: 'refund-worker-1c5v',     ns: 'payments',   status: 'crashloop', cpu: 0.01, mem: 0.03 },
        { name: 'refund-worker-2d6w',     ns: 'payments',   status: 'crashloop', cpu: 0.01, mem: 0.03 },
        { name: 'adyen-connector-7p3x',   ns: 'payments',   status: 'running',   cpu: 0.04, mem: 0.05 },
        { name: 'node-exporter-ds-w7',    ns: 'monitoring', status: 'running',   cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w7',        ns: 'monitoring', status: 'running',   cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-8  node-front-01 — 20 pods ────────────────────────────────────────────
    {
      id: 'w-8', name: 'node-front-01', role: 'worker',
      cpuPct: 0.62, memPct: 0.54, ready: true,
      pods: p([
        ...replicas('storefront-next-4t8p', 'production', 8, 0.07, 0.06),
        ...replicas('image-optimizer-7k1w', 'production', 4, 0.04, 0.04),
        ...replicas('a-b-testing-edge-5k',  'production', 3, 0.03, 0.04),
        { name: 'cdn-origin-proxy-6c8r',   ns: 'production', status: 'running', cpu: 0.06, mem: 0.06 },
        { name: 'static-assets-cdn-3p7m',  ns: 'production', status: 'running', cpu: 0.04, mem: 0.05 },
        { name: 'feature-flags-svc-8v1p',  ns: 'production', status: 'running', cpu: 0.03, mem: 0.04 },
        { name: 'node-exporter-ds-w8',     ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w8',         ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-9  node-front-02 — 18 pods ────────────────────────────────────────────
    {
      id: 'w-9', name: 'node-front-02', role: 'worker',
      cpuPct: 0.56, memPct: 0.48, ready: true,
      pods: p([
        ...replicas('storefront-next-4t8p', 'production', 7, 0.07, 0.06),
        ...replicas('image-optimizer-7k1w', 'production', 4, 0.04, 0.04),
        ...replicas('pwa-service-worker-2p', 'production', 3, 0.03, 0.03),
        { name: 'ssr-cache-svc-9k2m',      ns: 'production', status: 'running', cpu: 0.05, mem: 0.05 },
        { name: 'analytics-collector-4t',  ns: 'production', status: 'running', cpu: 0.03, mem: 0.04 },
        { name: 'node-exporter-ds-w9',     ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w9',         ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-10 node-search-01 — 14 pods ───────────────────────────────────────────
    {
      id: 'w-10', name: 'node-search-01', role: 'worker',
      cpuPct: 0.72, memPct: 0.80, ready: true,
      pods: p([
        { name: 'elasticsearch-catalog-0', ns: 'search', status: 'running', cpu: 0.28, mem: 0.38 },
        { name: 'elasticsearch-catalog-1', ns: 'search', status: 'running', cpu: 0.24, mem: 0.32 },
        ...replicas('search-api-6n3p',     'search', 5, 0.05, 0.05),
        ...replicas('search-suggest-7q2p', 'search', 3, 0.04, 0.04),
        { name: 'search-indexer-4k9m',    ns: 'search',     status: 'running', cpu: 0.05, mem: 0.07 },
        { name: 'synonym-svc-3m8k',       ns: 'search',     status: 'running', cpu: 0.03, mem: 0.03 },
        { name: 'node-exporter-ds-w10',   ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w10',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-11 node-search-02 — 13 pods ───────────────────────────────────────────
    {
      id: 'w-11', name: 'node-search-02', role: 'worker',
      cpuPct: 0.65, memPct: 0.75, ready: true,
      pods: p([
        { name: 'elasticsearch-catalog-2', ns: 'search', status: 'running', cpu: 0.22, mem: 0.34 },
        { name: 'typesense-0',             ns: 'search', status: 'running', cpu: 0.18, mem: 0.22 },
        ...replicas('search-api-6n3p',     'search', 4, 0.05, 0.05),
        ...replicas('faceted-search-8p1k', 'search', 3, 0.04, 0.04),
        { name: 'nlp-processor-7v3m',     ns: 'search',     status: 'running', cpu: 0.08, mem: 0.09 },
        { name: 'node-exporter-ds-w11',   ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w11',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-12 node-reco-01 — 14 pods ─────────────────────────────────────────────
    {
      id: 'w-12', name: 'node-reco-01', role: 'worker',
      cpuPct: 0.90, memPct: 0.86, ready: true,
      pods: p([
        ...replicas('reco-engine-9z4t',    'ml', 4, 0.18, 0.16),
        ...replicas('embedding-svc-5n3q',  'ml', 4, 0.10, 0.12),
        ...replicas('feature-store-2k8p',  'ml', 2, 0.06, 0.08),
        { name: 'model-trainer-7p2m',     ns: 'ml',         status: 'running', cpu: 0.14, mem: 0.18 },
        { name: 'ab-testing-router-4f9d', ns: 'ml',         status: 'running', cpu: 0.06, mem: 0.07 },
        { name: 'node-exporter-ds-w12',   ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w12',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-13 node-reco-02 — 12 pods ─────────────────────────────────────────────
    {
      id: 'w-13', name: 'node-reco-02', role: 'worker',
      cpuPct: 0.82, memPct: 0.78, ready: true,
      pods: p([
        ...replicas('personalization-7v3x', 'ml', 4, 0.14, 0.14),
        ...replicas('reco-engine-9z4t',     'ml', 3, 0.16, 0.14),
        { name: 'model-serving-5v1k',      ns: 'ml',         status: 'failed',  cpu: 0.00, mem: 0.04 },
        { name: 'model-serving-6w2m',      ns: 'ml',         status: 'failed',  cpu: 0.00, mem: 0.04 },
        { name: 'model-registry-3p7n',     ns: 'ml',         status: 'running', cpu: 0.06, mem: 0.08 },
        { name: 'node-exporter-ds-w13',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w13',        ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-14 node-data-01 — 12 pods ─────────────────────────────────────────────
    {
      id: 'w-14', name: 'node-data-01', role: 'worker',
      cpuPct: 0.62, memPct: 0.88, ready: true,
      pods: p([
        { name: 'postgres-orders-primary-0', ns: 'data', status: 'running', cpu: 0.22, mem: 0.45 },
        { name: 'postgres-orders-replica-0', ns: 'data', status: 'running', cpu: 0.14, mem: 0.30 },
        { name: 'postgres-orders-replica-1', ns: 'data', status: 'running', cpu: 0.12, mem: 0.28 },
        { name: 'postgres-orders-replica-2', ns: 'data', status: 'running', cpu: 0.11, mem: 0.26 },
        { name: 'pgbouncer-orders-5d9f',     ns: 'data',       status: 'running', cpu: 0.06, mem: 0.07 },
        { name: 'pgbouncer-orders-6e8g',     ns: 'data',       status: 'running', cpu: 0.05, mem: 0.06 },
        { name: 'postgres-exporter-4t7p',    ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
        { name: 'pg-backup-cron-7m2k',       ns: 'data',       status: 'running', cpu: 0.03, mem: 0.04 },
        { name: 'pg-logical-repl-3n9p',      ns: 'data',       status: 'running', cpu: 0.04, mem: 0.05 },
        { name: 'node-exporter-ds-w14',      ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w14',          ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-15 node-data-02 — 12 pods ─────────────────────────────────────────────
    {
      id: 'w-15', name: 'node-data-02', role: 'worker',
      cpuPct: 0.55, memPct: 0.82, ready: true,
      pods: p([
        { name: 'postgres-catalog-primary-0', ns: 'data', status: 'running', cpu: 0.20, mem: 0.42 },
        { name: 'postgres-catalog-replica-0', ns: 'data', status: 'running', cpu: 0.12, mem: 0.28 },
        { name: 'postgres-catalog-replica-1', ns: 'data', status: 'running', cpu: 0.10, mem: 0.25 },
        { name: 'redis-sessions-0',           ns: 'data', status: 'running', cpu: 0.06, mem: 0.10 },
        { name: 'redis-sessions-1',           ns: 'data', status: 'running', cpu: 0.05, mem: 0.09 },
        { name: 'redis-sessions-2',           ns: 'data', status: 'running', cpu: 0.05, mem: 0.09 },
        { name: 'redis-cache-0',              ns: 'data', status: 'running', cpu: 0.07, mem: 0.11 },
        { name: 'redis-cache-1',              ns: 'data', status: 'running', cpu: 0.06, mem: 0.10 },
        { name: 'redis-exporter-3k7p',       ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
        { name: 'node-exporter-ds-w15',      ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w15',          ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-16 node-messaging-01 — 14 pods ────────────────────────────────────────
    {
      id: 'w-16', name: 'node-messaging-01', role: 'worker',
      cpuPct: 0.52, memPct: 0.72, ready: true,
      pods: p([
        { name: 'kafka-events-0',           ns: 'messaging', status: 'running', cpu: 0.14, mem: 0.22 },
        { name: 'kafka-events-1',           ns: 'messaging', status: 'running', cpu: 0.12, mem: 0.20 },
        { name: 'kafka-events-2',           ns: 'messaging', status: 'running', cpu: 0.11, mem: 0.19 },
        { name: 'zookeeper-0',              ns: 'messaging', status: 'running', cpu: 0.04, mem: 0.08 },
        { name: 'zookeeper-1',              ns: 'messaging', status: 'running', cpu: 0.03, mem: 0.07 },
        { name: 'zookeeper-2',              ns: 'messaging', status: 'running', cpu: 0.03, mem: 0.07 },
        { name: 'kafka-schema-registry-0',  ns: 'messaging', status: 'running', cpu: 0.04, mem: 0.06 },
        ...replicas('kafka-consumer-order', 'messaging', 3, 0.04, 0.05),
        { name: 'dead-letter-handler-7m2p', ns: 'messaging', status: 'running', cpu: 0.03, mem: 0.04 },
        { name: 'node-exporter-ds-w16',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
      ]),
    },

    // ── w-17 node-messaging-02 — 13 pods ────────────────────────────────────────
    {
      id: 'w-17', name: 'node-messaging-02', role: 'worker',
      cpuPct: 0.44, memPct: 0.64, ready: true,
      pods: p([
        { name: 'kafka-events-3',           ns: 'messaging', status: 'running', cpu: 0.10, mem: 0.18 },
        { name: 'kafka-events-4',           ns: 'messaging', status: 'running', cpu: 0.09, mem: 0.17 },
        { name: 'kafka-connect-3k9p',       ns: 'messaging', status: 'running', cpu: 0.05, mem: 0.08 },
        ...replicas('kafka-consumer-notif', 'messaging', 4, 0.04, 0.05),
        ...replicas('kafka-consumer-reco',  'messaging', 3, 0.03, 0.04),
        { name: 'kafka-ui-7p4m',           ns: 'messaging', status: 'running', cpu: 0.02, mem: 0.03 },
        { name: 'node-exporter-ds-w17',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w17',        ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-18 node-obs-01 — 14 pods ──────────────────────────────────────────────
    {
      id: 'w-18', name: 'node-obs-01', role: 'worker',
      cpuPct: 0.40, memPct: 0.62, ready: true,
      pods: p([
        { name: 'prometheus-0',             ns: 'monitoring', status: 'running', cpu: 0.12, mem: 0.25 },
        { name: 'prometheus-1',             ns: 'monitoring', status: 'running', cpu: 0.10, mem: 0.22 },
        { name: 'grafana-6d8f9b',           ns: 'monitoring', status: 'running', cpu: 0.08, mem: 0.14 },
        { name: 'alertmanager-0',           ns: 'monitoring', status: 'running', cpu: 0.04, mem: 0.08 },
        { name: 'alertmanager-1',           ns: 'monitoring', status: 'running', cpu: 0.03, mem: 0.07 },
        { name: 'loki-0',                   ns: 'monitoring', status: 'running', cpu: 0.06, mem: 0.10 },
        { name: 'loki-1',                   ns: 'monitoring', status: 'running', cpu: 0.05, mem: 0.09 },
        { name: 'tempo-0',                  ns: 'monitoring', status: 'running', cpu: 0.05, mem: 0.10 },
        { name: 'otel-collector-3p8x',      ns: 'monitoring', status: 'running', cpu: 0.04, mem: 0.04 },
        { name: 'otel-collector-4q9y',      ns: 'monitoring', status: 'running', cpu: 0.04, mem: 0.04 },
        { name: 'pyroscope-0',              ns: 'monitoring', status: 'running', cpu: 0.03, mem: 0.06 },
        { name: 'k8s-event-logger-5n2p',   ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
        { name: 'node-exporter-ds-w18',    ns: 'monitoring', status: 'running', cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w18',        ns: 'monitoring', status: 'running', cpu: 0.02, mem: 0.03 },
      ]),
    },

    // ── w-19 node-infra-01 — 10 pods — NotReady ─────────────────────────────────
    {
      id: 'w-19', name: 'node-infra-01', role: 'worker',
      cpuPct: 0.20, memPct: 0.30, ready: false,
      pods: p([
        { name: 'vault-0',                   ns: 'security',     status: 'failed',    cpu: 0.00, mem: 0.05 },
        { name: 'vault-1',                   ns: 'security',     status: 'failed',    cpu: 0.00, mem: 0.04 },
        { name: 'vault-2',                   ns: 'security',     status: 'failed',    cpu: 0.00, mem: 0.04 },
        { name: 'external-secrets-5k2p',     ns: 'security',     status: 'crashloop', cpu: 0.01, mem: 0.03 },
        { name: 'external-secrets-6l3q',     ns: 'security',     status: 'crashloop', cpu: 0.01, mem: 0.03 },
        { name: 'cert-manager-7c9x',         ns: 'cert-manager', status: 'running',   cpu: 0.02, mem: 0.04 },
        { name: 'cert-manager-webhook-4n2p', ns: 'cert-manager', status: 'running',   cpu: 0.01, mem: 0.03 },
        { name: 'falco-ds-w19',              ns: 'security',     status: 'running',   cpu: 0.03, mem: 0.05 },
        { name: 'node-exporter-ds-w19',      ns: 'monitoring',   status: 'running',   cpu: 0.01, mem: 0.02 },
        { name: 'fluentbit-ds-w19',          ns: 'monitoring',   status: 'running',   cpu: 0.02, mem: 0.03 },
      ]),
    },
  ],
}
