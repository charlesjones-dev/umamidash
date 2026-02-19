import { ref, onUnmounted } from 'vue'
import type { RealtimeData } from '@/types'

export function useRealtimeStream() {
  const visitors = ref(new Map<string, number>())
  const connected = ref(false)
  let eventSource: EventSource | null = null

  function connect() {
    eventSource = new EventSource('/api/realtime/stream')

    eventSource.onopen = () => {
      connected.value = true
    }

    eventSource.onmessage = (event) => {
      const data: RealtimeData[] = JSON.parse(event.data)
      const updated = new Map(visitors.value)
      for (const item of data) {
        updated.set(item.websiteId, item.visitors)
      }
      visitors.value = updated
    }

    eventSource.onerror = () => {
      connected.value = false
      // EventSource auto-reconnects on transient failures
    }
  }

  connect()

  onUnmounted(() => {
    eventSource?.close()
    eventSource = null
  })

  return { visitors, connected }
}
