<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DashboardConfig } from '@/types'
import { useRealtimeStream } from '@/composables/useRealtimeStream'
import ActiveVisitorCard from '@/components/ActiveVisitorCard.vue'

const config = ref<DashboardConfig | null>(null)
const error = ref<string | null>(null)
const { visitors, countries, urls, series, connected } = useRealtimeStream()

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
  <div v-if="error" class="text-destructive">{{ error }}</div>
  <div v-else-if="!config" class="text-muted-foreground">Loading...</div>
  <template v-else>
    <div v-if="!connected" class="mb-4 text-sm text-muted-foreground">Reconnecting...</div>
    <div
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
  </template>
</template>
