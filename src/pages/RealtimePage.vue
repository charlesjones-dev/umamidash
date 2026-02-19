<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DashboardConfig } from '@/types'
import { useRealtimeStream } from '@/composables/useRealtimeStream'
import ActiveVisitorCard from '@/components/ActiveVisitorCard.vue'

const config = ref<DashboardConfig | null>(null)
const error = ref<string | null>(null)
const { visitors, connected } = useRealtimeStream()

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
      class="grid gap-4"
      :style="{ gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))` }"
    >
      <ActiveVisitorCard
        v-for="site in config.websites"
        :key="site.id"
        :website-name="site.name"
        :visitors="visitors.get(site.id) ?? null"
        :realtime-url="`${config.umamiUrl}/websites/${site.id}/realtime`"
      />
    </div>
  </template>
</template>
