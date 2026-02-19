<script setup lang="ts">
import { Palette } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/composables/useTheme'

const { themeName, themes, setTheme } = useTheme()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon">
        <Palette class="size-4" />
        <span class="sr-only">Choose theme</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-40">
      <DropdownMenuRadioGroup :model-value="themeName" @update:model-value="setTheme">
        <DropdownMenuRadioItem
          v-for="theme in themes"
          :key="theme.name"
          :value="theme.name"
        >
          <span
            class="mr-2 inline-block size-3 rounded-full border"
            :style="{ backgroundColor: theme.swatch }"
          />
          {{ theme.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
