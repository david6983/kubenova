import type { Pod } from '../types'

// Fixed muted colors for Kubernetes system namespaces
const SYSTEM_NS_COLORS: Record<string, string> = {
  'kube-system':      '#3d7ab5',
  'kube-public':      '#2d5a85',
  'kube-node-lease':  '#2a4d70',
}

// 12 visually distinct colors; namespace names hash into this palette so
// any cluster gets consistent, stable colors without any config.
const PALETTE = [
  '#00b4ff',
  '#00e87a',
  '#ffc700',
  '#b44dff',
  '#ff5577',
  '#33ddcc',
  '#ff9933',
  '#cc44ff',
  '#44ddff',
  '#ff4488',
  '#88ee44',
  '#ffdd44',
]

function hashNamespace(ns: string): number {
  let h = 5381
  for (let i = 0; i < ns.length; i++) h = (h * 33) ^ ns.charCodeAt(i)
  return Math.abs(h)
}

export function getNsColor(ns: string): string {
  return SYSTEM_NS_COLORS[ns] ?? PALETTE[hashNamespace(ns) % PALETTE.length]
}

export function dominantNamespace(pods: Pod[]): string {
  if (!pods.length) return 'kube-system'
  const counts: Record<string, number> = {}
  for (const p of pods) counts[p.namespace] = (counts[p.namespace] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}
