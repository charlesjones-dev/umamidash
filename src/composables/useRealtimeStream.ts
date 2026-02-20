import { ref, onUnmounted } from 'vue'
import type { RealtimeData, CountryData, UrlData, SeriesPoint } from '@/types'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'
export const connectionStatus = ref<ConnectionStatus>('reconnecting')

export function useRealtimeStream() {
  const visitors = ref(new Map<string, number>())
  const countries = ref(new Map<string, CountryData[]>())
  const urls = ref(new Map<string, UrlData[]>())
  const series = ref(new Map<string, SeriesPoint[]>())
  let eventSource: EventSource | null = null

  function connect() {
    eventSource = new EventSource('/api/realtime/stream')

    eventSource.onopen = () => {
      connectionStatus.value = 'connected'
    }

    eventSource.onmessage = (event) => {
      const data: RealtimeData[] = JSON.parse(event.data)
      const updatedVisitors = new Map(visitors.value)
      const updatedCountries = new Map(countries.value)
      const updatedUrls = new Map(urls.value)
      const updatedSeries = new Map(series.value)
      for (const item of data) {
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

    eventSource.onerror = () => {
      if (eventSource?.readyState === EventSource.CLOSED) {
        connectionStatus.value = 'disconnected'
      } else {
        connectionStatus.value = 'reconnecting'
      }
    }
  }

  connect()

  onUnmounted(() => {
    eventSource?.close()
    eventSource = null
  })

  return { visitors, countries, urls, series }
}
