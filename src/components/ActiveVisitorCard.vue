<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

defineProps<{
  websiteName: string
  visitors: number | null
  realtimeUrl: string
}>()
</script>

<template>
  <Card class="relative">
    <CardHeader class="pb-2">
      <CardTitle class="text-sm font-medium text-muted-foreground">
        {{ websiteName }}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div class="text-4xl font-bold tabular-nums">
        {{ visitors === null ? '...' : visitors }}
      </div>
      <p class="text-xs text-muted-foreground mt-1">active visitors</p>
    </CardContent>
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
