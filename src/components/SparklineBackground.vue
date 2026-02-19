<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SeriesPoint } from '@/types'

const props = defineProps<{
  data: SeriesPoint[]
}>()

const gradientId = computed(() => `sparkline-grad-${Math.random().toString(36).slice(2, 9)}`)

const MAX_HEIGHT = 45

const maxValue = computed(() => {
  if (props.data.length < 2) return 0
  return Math.max(...props.data.map((p) => p.y))
})

const bars = computed(() => {
  const points = props.data
  if (points.length < 2) return []

  const max = Math.max(...points.map((p) => p.y), 1)
  const slotWidth = 100 / points.length
  const gap = slotWidth * 0.15
  const barWidth = slotWidth - gap

  return points.map((p, i) => {
    const height = (p.y / max) * MAX_HEIGHT
    return {
      x: i * slotWidth + gap / 2,
      y: 100 - height,
      width: barWidth,
      height: p.y > 0 ? Math.max(height, 1) : 0,
    }
  })
})

// Tooltip
const hoveredIndex = ref<number | null>(null)

const tooltip = computed(() => {
  if (hoveredIndex.value === null) return null
  const point = props.data[hoveredIndex.value]
  const bar = bars.value[hoveredIndex.value]
  if (!point || !bar || point.y === 0) return null
  const left = bar.x + bar.width / 2
  const align = left < 12 ? 'left' : left > 88 ? 'right' : 'center'
  return {
    label: formatTime(point.x),
    count: point.y,
    left,
    bottom: Math.max(100 - bar.y + 2, 5),
    align,
  }
})

function formatTime(x: string): string {
  const d = new Date(x.replace(' ', 'T'))
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    hour12: true,
  })
}
</script>

<template>
  <div v-if="data.length >= 2" class="absolute inset-0 pointer-events-none" aria-hidden="true">
    <svg class="h-full w-full text-chart-1" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.2" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0.05" />
        </linearGradient>
      </defs>
      <!-- Invisible hit targets (full column height) -->
      <rect
        v-for="(bar, i) in bars"
        :key="`hit-${i}`"
        class="pointer-events-auto cursor-default"
        :x="bar.x"
        y="0"
        :width="bar.width"
        height="100"
        fill="transparent"
        @pointerenter="hoveredIndex = i"
        @pointerleave="hoveredIndex = null"
      />
      <!-- Visible bars -->
      <rect
        v-for="(bar, i) in bars"
        :key="i"
        class="pointer-events-none"
        :class="hoveredIndex === i ? 'opacity-100' : ''"
        :x="bar.x"
        :y="bar.y"
        :width="bar.width"
        :height="bar.height"
        :fill="`url(#${gradientId})`"
      />
    </svg>

    <!-- Tooltip -->
    <div
      v-if="tooltip"
      class="pointer-events-none absolute z-50 rounded-md bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-md ring-1 ring-border/50 whitespace-nowrap"
      :class="{
        '-translate-x-1/2': tooltip.align === 'center',
        'translate-x-0': tooltip.align === 'left',
        '-translate-x-full': tooltip.align === 'right',
      }"
      :style="{ left: `${tooltip.left}%`, bottom: `${tooltip.bottom}%` }"
    >
      {{ tooltip.label }} <span class="text-muted-foreground/60 mx-0.5">&middot;</span> <span class="font-semibold tabular-nums">{{ tooltip.count }}</span>
    </div>

    <!-- Peak count hint -->
    <span
      v-if="maxValue > 0"
      class="absolute left-1.5 text-[10px] tabular-nums font-medium text-muted-foreground/50 leading-none"
      :style="{ bottom: `${MAX_HEIGHT + 1}%` }"
    >
      {{ maxValue }}
    </span>

    <!-- Time range hint -->
    <span class="absolute bottom-0.5 left-2 text-[9px] text-muted-foreground/40 leading-none">
      -24h
    </span>
  </div>
</template>
