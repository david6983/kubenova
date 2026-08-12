import type { Pod } from '../types'

export const NS_COLORS: Record<string, string> = {
  'production':   '#00b4ff',
  'payments':     '#ffc700',
  'data':         '#00e87a',
  'ml':           '#b44dff',
  'monitoring':   '#ff5577',
  'security':     '#ff4400',
  'kube-system':  '#3d7ab5',
  'ingress':      '#00ccaa',
  'cert-manager': '#7799bb',
  'search':       '#ff9933',
  'messaging':    '#cc44ff',
  'gateway':      '#33ddcc',
}

const DEFAULT_COLOR = '#556677'

export function getNsColor(ns: string): string {
  return NS_COLORS[ns] ?? DEFAULT_COLOR
}

export function dominantNamespace(pods: Pod[]): string {
  if (!pods.length) return 'kube-system'
  const counts: Record<string, number> = {}
  for (const p of pods) counts[p.namespace] = (counts[p.namespace] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}
