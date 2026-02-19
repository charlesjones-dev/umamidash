<script setup lang="ts">
import { Activity, Sun, Moon } from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { useDarkMode } from '@/composables/useDarkMode'

const { isDark, toggle } = useDarkMode()
</script>

<template>
  <Sidebar>
    <SidebarHeader class="p-4">
      <span class="text-lg font-bold">UmamiDash</span>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton as-child>
                <RouterLink to="/realtime">
                  <Activity class="size-4" />
                  <span>Realtime</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter class="p-4">
      <Button variant="ghost" size="icon" @click="toggle">
        <Sun v-if="isDark" class="size-4" />
        <Moon v-else class="size-4" />
        <span class="sr-only">Toggle dark mode</span>
      </Button>
    </SidebarFooter>
  </Sidebar>
</template>
