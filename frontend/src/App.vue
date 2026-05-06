<template>
  <div v-if="isAuthenticated" class="h-screen flex overflow-hidden">
    <Sidebar />
    <main class="flex-1 overflow-auto bg-muted">
      <router-view />
    </main>
  </div>
  <router-view v-else />
  <Teleport to="body">
    <Toaster :theme="theme" richColors position="top-center" :toastOptions="{ duration: 4000 }" />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Sidebar from '@/components/layout/Sidebar.vue'
import { Toaster } from '@/components/ui/sonner'
import { api } from '@/api/client'
import { isDark } from '@/composables/useTheme'

const router = useRouter()
const route = useRoute()
const isAuthenticated = ref(false)

const theme = computed(() => isDark.value ? 'dark' : 'light')

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
  } catch (err: unknown) {
    isAuthenticated.value = false
    const code = (err as { apiCode?: number }).apiCode
    const CODE_NOT_INITIALIZED = 40_103
    if (code === CODE_NOT_INITIALIZED) {
      router.push('/setup')
    } else {
      router.push('/login')
    }
  }
}

checkAuth()
watch(() => route.path, checkAuth)
</script>
