<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import SparklineBackground from '@/components/SparklineBackground.vue'
import type { CountryData, UrlData, SeriesPoint } from '@/types'

const props = defineProps<{
  websiteName: string
  websiteDomain?: string
  visitors: number | null
  countries: CountryData[]
  urls: UrlData[]
  series: SeriesPoint[]
  realtimeUrl: string
}>()

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
    <span class="absolute top-4 left-6 text-lg font-medium text-muted-foreground">
      {{ websiteName }}
    </span>

    <!-- Top-right: countries -->
    <ul v-if="countries.length" class="absolute top-4 right-6 text-xs text-muted-foreground space-y-0.5 text-right">
      <li v-for="c in countries" :key="c.country" class="tabular-nums">
        {{ c.country }} <span class="font-medium text-foreground">{{ c.visitors }}</span>
      </li>
    </ul>

    <!-- Center: visitor count -->
    <div class="text-center">
      <div class="text-7xl font-bold tabular-nums">
        {{ visitors === null ? '...' : visitors }}
      </div>
      <p class="text-sm text-muted-foreground mt-1">active visitors</p>
    </div>

    <!-- Bottom-left: URLs -->
    <ul v-if="urls.length" class="absolute bottom-4 left-6 text-xs text-muted-foreground space-y-0.5">
      <li v-for="u in urls" :key="u.url" class="tabular-nums">
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
  </Card>
</template>
