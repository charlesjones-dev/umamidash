<script setup lang="ts">
import { ref } from 'vue'
import { ExternalLink, Globe } from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import SparklineBackground from '@/components/SparklineBackground.vue'
import SessionMapModal from '@/components/SessionMapModal.vue'
import type { CountryData, UrlData, SeriesPoint } from '@/types'

const props = defineProps<{
  websiteId: string
  websiteName: string
  websiteDomain?: string
  visitors: number | null
  countries: CountryData[]
  urls: UrlData[]
  series: SeriesPoint[]
  realtimeUrl: string
}>()

const mapModalOpen = ref(false)
const mapInitialWindow = ref(5)

function openMap(defaultWindow: number) {
  mapInitialWindow.value = defaultWindow
  mapModalOpen.value = true
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}

function fullUrl(path: string): string | undefined {
  if (!props.websiteDomain) return undefined
  return `https://${props.websiteDomain}${path}`
}

</script>

<template>
  <Card class="relative min-h-0 flex-1 items-center justify-center overflow-hidden">
    <SparklineBackground :data="series" />

    <!-- Top-left: website name -->
    <a
      v-if="websiteDomain"
      :href="`https://${websiteDomain}`"
      target="_blank"
      rel="noopener noreferrer"
      class="absolute top-4 left-6 text-[0.5625rem] sm:text-lg font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors"
    >
      {{ websiteName }}
    </a>
    <span v-else class="absolute top-4 left-6 text-[0.5625rem] sm:text-lg font-medium text-muted-foreground">
      {{ websiteName }}
    </span>

    <!-- Top-right: countries (clickable to open map) or map icon when empty -->
    <button
      v-if="countries.length"
      class="absolute top-4 right-6 cursor-pointer text-right transition-opacity hover:opacity-70"
      @click="openMap(5)"
    >
      <ul class="text-xs text-muted-foreground space-y-0.5">
        <li v-for="c in countries" :key="c.country" class="tabular-nums">
          {{ c.country }} <span class="font-medium text-foreground">{{ c.visitors }}</span>
        </li>
      </ul>
    </button>
    <Button
      v-else
      variant="ghost"
      size="icon"
      class="absolute top-2 right-2 size-7 text-muted-foreground"
      @click="openMap(30)"
    >
      <Globe class="size-3.5" />
      <span class="sr-only">Open session map</span>
    </Button>

    <!-- Center: visitor count -->
    <div class="text-center">
      <div class="text-5xl sm:text-7xl font-bold tabular-nums">
        {{ visitors === null ? '...' : visitors }}
      </div>
      <p class="text-sm text-muted-foreground mt-1">active visitors</p>
    </div>

    <!-- Bottom-left: URLs -->
    <ul v-if="urls.length" class="absolute bottom-4 left-6 text-xs text-muted-foreground space-y-0.5 max-w-[25%] overflow-hidden sm:max-w-none">
      <li v-for="(u, i) in urls" :key="u.url" class="tabular-nums" :class="{ 'hidden sm:list-item': i >= 2 }">
        <span class="font-medium text-foreground">{{ u.visitors }}</span>{{ ' '
        }}<a
          v-if="fullUrl(u.url)"
          :href="fullUrl(u.url)"
          target="_blank"
          rel="noopener noreferrer"
          :title="u.url"
          class="hover:text-foreground hover:underline"
        >{{ truncate(u.url, 20) }}</a
        ><span v-else :title="u.url">{{ truncate(u.url, 20) }}</span>
      </li>
    </ul>

    <!-- Bottom-right: Umami link -->
    <Button
      variant="ghost"
      size="icon"
      class="absolute bottom-2 right-2 size-7 text-muted-foreground"
      as="a"
      :href="realtimeUrl"
      target="_blank"
      rel="noopener noreferrer"
    >
      <ExternalLink class="size-3.5" />
      <span class="sr-only">Open in Umami</span>
    </Button>
    <SessionMapModal
      v-model:open="mapModalOpen"
      :website-id="websiteId"
      :website-name="websiteName"
      :initial-window="mapInitialWindow"
    />
  </Card>
</template>
