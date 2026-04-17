<template>
  <div v-if="isAuthenticated" class="min-h-screen flex">
    <Sidebar />
    <main class="flex-1 overflow-auto bg-muted">
      <router-view />
    </main>
  </div>
  <router-view v-else />
  <Toaster richColors position="top-center" />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Sidebar from '@/components/layout/Sidebar.vue'
import { Toaster } from '@/components/ui/sonner'
import { api } from '@/api/client'

const router = useRouter()
const route = useRoute()
const isAuthenticated = ref(false)

// 不需要认证的页面
const publicPages = ['/login', '/setup']

async function checkAuth() {
  if (publicPages.includes(route.path)) {
    isAuthenticated.value = false
    return
  }
  try {
    await api.getStats()
    isAuthenticated.value = true
  } catch {
    isAuthenticated.value = false
    router.push('/login')
  }
}

checkAuth()
watch(() => route.path, checkAuth)
</script>
