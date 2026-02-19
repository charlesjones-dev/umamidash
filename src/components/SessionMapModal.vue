<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '@/composables/useTheme'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { GeocodedSession } from '@/types'

const props = defineProps<{
  websiteId: string
  websiteName: string
  initialWindow?: number
}>()

const open = defineModel<boolean>('open', { default: false })

const { isDark } = useTheme()

const sessions = ref<GeocodedSession[]>([])
const loading = ref(false)
const windowMinutes = ref(5)

const windowOptions = [
  { value: 5, label: '5m' },
  { value: 30, label: '30m' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
  { value: 10080, label: '7d' },
]

function windowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  if (minutes < 1440) return `${minutes / 60} hours`
  return `${minutes / 1440} days`
}
const mapContainer = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let tileLayer: L.TileLayer | null = null

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'

function getMarkerColor(): string {
  // Read the --primary CSS var and convert oklch → hex via canvas
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  if (!raw) return '#3b82f6'
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
  } catch {
    return '#3b82f6'
  }
}

async function fetchSessions() {
  loading.value = true
  try {
    const res = await fetch(`/api/websites/${props.websiteId}/sessions/geo?window=${windowMinutes.value}`)
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()
    sessions.value = data.sessions ?? []
  } catch (err) {
    console.error('Failed to fetch geo sessions:', err)
    sessions.value = []
  } finally {
    loading.value = false
  }
}

function updateTiles() {
  if (!map || !tileLayer) return
  map.removeLayer(tileLayer)
  tileLayer = L.tileLayer(isDark.value ? DARK_TILES : LIGHT_TILES, { attribution: ATTRIBUTION })
  tileLayer.addTo(map)
}

function renderMarkers() {
  if (!map || !markerLayer) return
  markerLayer.clearLayers()

  const color = getMarkerColor()

  for (const s of sessions.value) {
    const marker = L.circleMarker([s.lat, s.lng], {
      radius: 7,
      fillColor: color,
      fillOpacity: 0.8,
      color: color,
      weight: 2,
      opacity: 1,
    })

    const location = [s.city, s.region, s.country].filter(Boolean).join(', ')
    const deviceInfo = [s.browser, s.os].filter(Boolean).join(' on ')
    const deviceLine = s.device ? `${s.device}${s.screen ? ` (${s.screen})` : ''}` : s.screen || ''
    const ago = s.lastAt ? formatTimeAgo(s.lastAt) : ''

    const rows = [
      `<div class="popup-location">${location}</div>`,
      deviceInfo ? `<div class="popup-row"><span class="popup-label">Browser</span> ${deviceInfo}</div>` : '',
      deviceLine ? `<div class="popup-row"><span class="popup-label">Device</span> ${deviceLine}</div>` : '',
      s.language ? `<div class="popup-row"><span class="popup-label">Language</span> ${s.language}</div>` : '',
      ago ? `<div class="popup-row popup-time">Last active ${ago}</div>` : '',
    ].filter(Boolean).join('')

    marker.bindPopup(
      `<div class="map-popup-content">${rows}</div>`,
      { className: 'themed-popup', maxWidth: 280 }
    )
    markerLayer.addLayer(marker)
  }

  // Auto-zoom to fit all markers
  if (sessions.value.length > 0) {
    const bounds = L.latLngBounds(sessions.value.map((s) => [s.lat, s.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 5 })
  } else {
    map.setView([20, 0], 2)
  }
}

function initMap() {
  if (!mapContainer.value || map) return
  map = L.map(mapContainer.value, {
    zoomControl: true,
    attributionControl: true,
  }).setView([20, 0], 2)

  tileLayer = L.tileLayer(isDark.value ? DARK_TILES : LIGHT_TILES, { attribution: ATTRIBUTION })
  tileLayer.addTo(map)

  markerLayer = L.layerGroup().addTo(map)
}

function destroyMap() {
  if (map) {
    map.remove()
    map = null
    tileLayer = null
    markerLayer = null
  }
}

// When dialog opens, init map and fetch data
watch(open, async (isOpen) => {
  if (isOpen) {
    windowMinutes.value = props.initialWindow === 30 ? 30 : 5
    await nextTick()
    // Wait for dialog animation to settle
    setTimeout(() => {
      initMap()
      if (map) map.invalidateSize()
      fetchSessions()
    }, 300)
  } else {
    destroyMap()
    sessions.value = []
  }
})

// Re-render markers when sessions change
watch(sessions, () => {
  renderMarkers()
})

// Switch tiles when dark mode toggles
watch(isDark, () => {
  updateTiles()
})

// When window changes, refetch
watch(windowMinutes, () => {
  fetchSessions()
})

onBeforeUnmount(() => {
  destroyMap()
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-4xl h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
      <DialogHeader class="px-6 pt-6 pb-4 flex-none">
        <div class="flex items-center justify-between">
          <div>
            <DialogTitle>{{ websiteName }} — Active Sessions</DialogTitle>
            <DialogDescription>
              {{ loading ? 'Loading...' : `${sessions.length} session${sessions.length !== 1 ? 's' : ''}` }}
              in the last {{ windowLabel(windowMinutes) }}
            </DialogDescription>
          </div>
          <div class="flex gap-1 mr-8">
            <Button
              v-for="opt in windowOptions"
              :key="opt.value"
              size="sm"
              :variant="windowMinutes === opt.value ? 'default' : 'outline'"
              @click="windowMinutes = opt.value"
            >
              {{ opt.label }}
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div class="relative flex-1 min-h-0">
        <div ref="mapContainer" class="absolute inset-0" />

        <!-- Loading overlay -->
        <div
          v-if="loading"
          class="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60"
        >
          <span class="text-sm text-muted-foreground">Loading sessions...</span>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style>
.themed-popup .leaflet-popup-content-wrapper {
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.themed-popup .leaflet-popup-tip {
  background: var(--popover);
  border: 1px solid var(--border);
  border-top: none;
  border-right: none;
}
.themed-popup .leaflet-popup-close-button {
  color: var(--muted-foreground);
}
.themed-popup .leaflet-popup-close-button:hover {
  color: var(--foreground);
}
.map-popup-content {
  font-size: 13px;
  line-height: 1.5;
  min-width: 160px;
}
.popup-location {
  font-weight: 600;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.popup-row {
  margin-top: 2px;
}
.popup-label {
  color: var(--muted-foreground);
}
.popup-time {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 12px;
}
</style>
