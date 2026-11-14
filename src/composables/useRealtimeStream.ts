import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { CountryData, DashboardConfig, RealtimeData, SeriesPoint, UrlData } from '@/types'
import { REALTIME_HEARTBEAT, REALTIME_STREAM_PATH } from '@/lib/realtime-protocol'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'
export const connectionStatus = ref<ConnectionStatus>('reconnecting')

const MAX_RETRY_DELAY_MS = 30_000
/** Failed WebSocket attempts in a row before the status shows "disconnected". */
const ATTEMPTS_BEFORE_DISCONNECTED = 3

/**
 * Live data per website. Connects once the config has loaded, over the
 * transport the server names: SSE (Node server) or WebSocket (Cloudflare
 * Worker).
 */
export function useRealtimeStream(config: Ref<DashboardConfig | null>) {
  const visitors = ref(new Map<string, number>())
  const countries = ref(new Map<string, CountryData[]>())
  const urls = ref(new Map<string, UrlData[]>())
  const series = ref(new Map<string, SeriesPoint[]>())
  let close: (() => void) | null = null

  function apply(message: string) {
    const data: unknown = JSON.parse(message)
    if (!Array.isArray(data)) return
    const updatedVisitors = new Map(visitors.value)
    const updatedCountries = new Map(countries.value)
    const updatedUrls = new Map(urls.value)
    const updatedSeries = new Map(series.value)
    for (const item of data as RealtimeData[]) {
      updatedVisitors.set(item.websiteId, item.visitors)
      updatedCountries.set(item.websiteId, item.countries ?? [])
      updatedUrls.set(item.websiteId, item.urls ?? [])
      updatedSeries.set(item.websiteId, item.series ?? [])
    }
    visitors.value = updatedVisitors
    countries.value = updatedCountries
    urls.value = updatedUrls
    series.value = updatedSeries
  }

  function connectSse(): () => void {
    const eventSource = new EventSource(REALTIME_STREAM_PATH)
    eventSource.onopen = () => {
      connectionStatus.value = 'connected'
    }
    eventSource.onmessage = (event) => apply(event.data)
    eventSource.onerror = () => {
      connectionStatus.value = eventSource.readyState === EventSource.CLOSED ? 'disconnected' : 'reconnecting'
    }
    return () => eventSource.close()
  }

  function connectWebSocket(pollIntervalMs: number): () => void {
    const url = new URL(REALTIME_STREAM_PATH, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // The server sends data or a heartbeat on every poll. Silence for three
    // polls means the connection is dead even if the socket hasn't noticed.
    const silenceLimitMs = 3 * pollIntervalMs + 10_000
    let socket: WebSocket | null = null
    let failures = 0
    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let silenceTimer: ReturnType<typeof setTimeout> | undefined

    function armSilenceTimer() {
      clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => socket?.close(), silenceLimitMs)
    }

    function open() {
      const ws = new WebSocket(url)
      socket = ws
      ws.onopen = () => {
        failures = 0
        connectionStatus.value = 'connected'
        armSilenceTimer()
      }
      ws.onmessage = (event) => {
        armSilenceTimer()
        if (typeof event.data === 'string' && event.data !== REALTIME_HEARTBEAT) apply(event.data)
      }
      ws.onclose = () => {
        clearTimeout(silenceTimer)
        if (stopped) return
        failures++
        connectionStatus.value = failures >= ATTEMPTS_BEFORE_DISCONNECTED ? 'disconnected' : 'reconnecting'
        const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** (failures - 1))
        retryTimer = setTimeout(open, delay)
      }
    }

    open()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearTimeout(silenceTimer)
      socket?.close()
    }
  }

  const stopWatch = watch(
    config,
    (value) => {
      if (!value || close) return
      close = value.realtimeTransport === 'websocket' ? connectWebSocket(value.pollInterval) : connectSse()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatch()
    close?.()
    close = null
  })

  return { visitors, countries, urls, series }
}
