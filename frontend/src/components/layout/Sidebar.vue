<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <aside class="w-56 bg-slate-800 text-white flex-shrink-0 flex flex-col">
    <div class="p-4 border-b border-slate-700">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
        <span class="font-semibold text-sm">LLM Router</span>
      </div>
    </div>
    <nav class="flex-1 p-2 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive(item.path) ? 'bg-slate-700 text-blue-400' : 'text-gray-300 hover:bg-slate-700'"
      >
        <component :is="item.icon" class="w-4 h-4" />
        {{ item.label }}
      </router-link>
    </nav>
    <div class="p-3 border-t border-slate-700">
      <Button
        variant="ghost"
        class="w-full justify-start text-gray-400 hover:text-white hover:bg-slate-700"
        @click="handleLogout"
      >
        <LogOut class="w-4 h-4" />
        登出
      </Button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { type Component, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Server,
  BarChart3,
  ArrowLeftRight,
  KeyRound,
  RefreshCcw,
  FileText,
  LogOut,
} from 'lucide-vue-next'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'

interface NavItem {
  path: string
  label: string
  icon: Component
}

// 与 router/index.ts 路由定义保持同步
const navItems: NavItem[] = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/providers', label: '供应商', icon: Server },
  { path: '/metrics', label: '性能指标', icon: BarChart3 },
  { path: '/mappings', label: '模型映射', icon: ArrowLeftRight },
  { path: '/router-keys', label: 'API 密钥', icon: KeyRound },
  { path: '/retry-rules', label: '重试规则', icon: RefreshCcw },
  { path: '/logs', label: '请求日志', icon: FileText },
]

const route = useRoute()
const router = useRouter()

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

async function handleLogout() {
  try {
    await api.logout()
  } finally {
    router.push('/login')
  }
}
</script>
