<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleDark } = useTheme()
</script>

<template>
  <Button variant="ghost" size="icon" @click="toggleDark">
    <Sun v-if="isDark" class="size-4" />
    <Moon v-else class="size-4" />
    <span class="sr-only">Toggle dark mode</span>
  </Button>
</template>
