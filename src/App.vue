<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DashboardConfig } from '@/types'
import { useRealtimeStream, connectionStatus } from '@/composables/useRealtimeStream'
import ActiveVisitorCard from '@/components/ActiveVisitorCard.vue'
import ThemeDropdown from '@/components/ThemeDropdown.vue'
import DarkModeToggle from '@/components/DarkModeToggle.vue'

const config = ref<DashboardConfig | null>(null)
const error = ref<string | null>(null)
const { visitors, countries, urls, series } = useRealtimeStream()

const lastCardSpan = computed(() => {
  if (!config.value) return 1
  const { columns, websites } = config.value
  if (columns < 2 || columns % 2 !== 0) return 1
  const remainder = websites.length % columns
  return remainder === 0 ? 1 : columns - remainder + 1
})

onMounted(async () => {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error(`Failed to load config (${res.status})`)
    config.value = await res.json()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dashboard config'
  }
})
</script>

<template>
  <div class="flex h-dvh flex-col">
    <header class="flex h-12 items-center gap-2 border-b px-4">
      <h1 class="text-sm font-semibold">UmamiDash</h1>
      <span
        class="relative flex size-2"
        :title="{ connected: 'Connected', reconnecting: 'Reconnecting...', disconnected: 'Disconnected' }[connectionStatus]"
      >
        <span
          class="relative inline-flex size-full animate-pulse rounded-full"
          style="animation-duration: 6s"
          :class="{
            'bg-green-500': connectionStatus === 'connected',
            'bg-yellow-500': connectionStatus === 'reconnecting',
            'bg-red-500': connectionStatus === 'disconnected',
          }"
        />
      </span>
      <div class="ml-auto flex items-center gap-1">
        <ThemeDropdown />
        <DarkModeToggle />
      </div>
    </header>
    <main class="flex min-h-0 flex-1 flex-col p-4">
      <div v-if="error" class="text-destructive">{{ error }}</div>
      <div v-else-if="!config" class="text-muted-foreground">Loading...</div>
      <div
        v-else
        class="grid min-h-0 flex-1 gap-4"
        :style="{
          gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(0, 1fr)',
        }"
      >
        <ActiveVisitorCard
          v-for="(site, index) in config.websites"
          :key="site.id"
          :website-id="site.id"
          :website-name="site.name"
          :website-domain="site.domain"
          :visitors="visitors.get(site.id) ?? null"
          :countries="countries.get(site.id) ?? []"
          :urls="urls.get(site.id) ?? []"
          :series="series.get(site.id) ?? []"
          :realtime-url="`${config.umamiUrl}/websites/${site.id}/realtime`"
          :style="index === config.websites.length - 1 && lastCardSpan > 1
            ? { gridColumn: `span ${lastCardSpan}` }
            : undefined"
        />
      </div>
    </main>
  </div>
</template>
