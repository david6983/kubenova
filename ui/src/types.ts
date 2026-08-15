export type PodStatus    = 'running' | 'pending' | 'failed' | 'crashloop'
export type NodeRole     = 'control-plane' | 'worker'
export type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset' | 'cronjob' | 'other'

export interface Pod {
  id: string
  name: string
  namespace: string
  status: PodStatus
  cpuPct: number
  memPct: number
  workloadKind: WorkloadKind
}

export interface ClusterNode {
  id: string
  name: string
  role: NodeRole
  cpuPct: number
  memPct: number
  ready: boolean
  pods: Pod[]
}

export interface NetworkFlow {
  srcPod:      string
  srcNs:       string
  dstPod:      string
  dstNs:       string
  bytesPerSec: number
  packets?: number
  latencyMs:   number
}

export interface Cluster {
  name:   string
  nodes:  ClusterNode[]
  flows?: NetworkFlow[]
}
