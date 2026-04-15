<template>
  <div v-if="isAuthenticated" class="min-h-screen flex">
    <Sidebar />
    <main class="flex-1 overflow-auto bg-gray-50">
      <router-view />
    </main>
  </div>
  <router-view v-else />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Sidebar from '@/components/layout/Sidebar.vue'
import { api } from '@/api/client'

const router = useRouter()
const route = useRoute()
const isAuthenticated = ref(false)

async function checkAuth() {
  if (route.path === '/admin/login') {
    isAuthenticated.value = false
    return
  }
  try {
    await api.getStats()
    isAuthenticated.value = true
  } catch {
    isAuthenticated.value = false
    router.push('/admin/login')
  }
}

checkAuth()
watch(() => route.path, checkAuth)
</script>
