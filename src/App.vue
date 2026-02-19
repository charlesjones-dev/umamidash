<script setup lang="ts">
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header class="flex h-12 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <h1 class="text-sm font-semibold">UmamiDash</h1>
      </header>
      <main class="flex-1 p-4">
        <RouterView />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
