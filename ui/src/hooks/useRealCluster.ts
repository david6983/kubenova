import { useState, useEffect, useRef } from 'react'
import type { Cluster } from '../types'
import type { SimEvent } from '../mock/useSimulatedCluster'

// In dev, Vite proxies /ws → localhost:3001 (see vite.config.ts).
// In production (nginx), nginx proxies /ws → kubeboat-server:3001.
const WS_URL      = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
const REST_URL    = '/api/cluster'
const WS_TIMEOUT  = 3000   // fall back to HTTP if WS not established within this
const POLL_MS     = 8000
const MAX_BACKOFF = 30_000

export function useRealCluster(): { cluster: Cluster; events: SimEvent[] } {
  const [cluster, setCluster] = useState<Cluster>({ name: 'shopnova-prod', nodes: [] })
  const [events,  setEvents]  = useState<SimEvent[]>([])

  const wsRef      = useRef<WebSocket | null>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(1000)
  const activeRef  = useRef(true)

  useEffect(() => {
    activeRef.current = true
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null

    // ── HTTP polling fallback ────────────────────────────────────────────────
    function startPolling() {
      async function poll() {
        if (!activeRef.current) return
        try {
          const res  = await fetch(REST_URL)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          if (activeRef.current) {
            setCluster(data.cluster)
            setEvents(data.events ?? [])
          }
        } catch (err) {
          console.warn('[useRealCluster] poll error:', err)
        }
        if (activeRef.current) timerRef.current = setTimeout(poll, POLL_MS)
      }
      poll()
    }

    // ── WebSocket connection ─────────────────────────────────────────────────
    function connect() {
      if (!activeRef.current) return

      let wsEstablished = false

      // If WS doesn't open within WS_TIMEOUT, fall back to polling
      fallbackTimer = setTimeout(() => {
        if (!wsEstablished) {
          console.warn('[useRealCluster] WS timeout — falling back to HTTP polling')
          startPolling()
        }
      }, WS_TIMEOUT)

      let ws: WebSocket
      try {
        ws = new WebSocket(WS_URL)
      } catch {
        clearTimeout(fallbackTimer!)
        startPolling()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        wsEstablished = true
        clearTimeout(fallbackTimer!)
        backoffRef.current = 1000
        // Cancel any running poll loop
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        console.log('[useRealCluster] WebSocket connected')
      }

      ws.onmessage = e => {
        if (!activeRef.current) return
        try {
          const data = JSON.parse(e.data)
          setCluster(data.cluster)
          setEvents(data.events ?? [])
        } catch (err) {
          console.warn('[useRealCluster] WS parse error:', err)
        }
      }

      ws.onclose = () => {
        if (!activeRef.current) return
        console.warn('[useRealCluster] WS closed — reconnecting in', backoffRef.current, 'ms')
        timerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF)
          connect()
        }, backoffRef.current)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      activeRef.current = false
      clearTimeout(fallbackTimer!)
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [])

  return { cluster, events }
}
