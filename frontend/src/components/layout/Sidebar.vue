<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <aside class="w-56 bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col">
    <div class="p-4 border-b border-sidebar-border">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-sidebar-primary rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-sidebar-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
        <span class="font-semibold text-sm">LLM Router</span>
        <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4 leading-none">v{{ appVersion }}</Badge>
      </div>
    </div>
    <nav class="flex-1 p-2 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive(item.path) ? 'bg-sidebar-accent text-sidebar-primary' : 'text-sidebar-foreground hover:bg-sidebar-accent'"
      >
        <component :is="item.icon" class="w-4 h-4" />
        {{ item.label }}
      </router-link>
    </nav>
    <div class="p-3 border-t border-sidebar-border">
      <Button
        variant="ghost"
        class="w-full justify-start text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
        @click="handleLogout"
      >
        <LogOut class="w-4 h-4" />
        登出
      </Button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Server,
  ArrowLeftRight,
  KeyRound,
  RefreshCcw,
  Sparkles,
  FileText,
  Activity,
  LogOut,
} from 'lucide-vue-next'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const appVersion = __APP_VERSION__

interface NavItem {
  path: string
  label: string
  icon: Component
}

// 与 router/index.ts 路由定义保持同步
const navItems: NavItem[] = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/providers', label: '供应商', icon: Server },
  { path: '/mappings', label: '模型映射', icon: ArrowLeftRight },
  { path: '/router-keys', label: 'API 密钥', icon: KeyRound },
  { path: '/retry-rules', label: '重试规则', icon: RefreshCcw },
  { path: '/proxy-enhancement', label: '代理增强（实验性）', icon: Sparkles },
  { path: '/monitor', label: '实时监控', icon: Activity },
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
