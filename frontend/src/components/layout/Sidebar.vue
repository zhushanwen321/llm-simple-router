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
        <Popover v-model:open="isOpen">
          <PopoverTrigger as-child>
            <Button variant="ghost" class="flex items-center gap-2 px-0 h-auto">
              <span class="font-semibold text-sm">LLM Router</span>
              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4 leading-none">v{{ appVersion }}</Badge>
              <Badge
                v-if="updateCount > 0"
                variant="destructive"
                class="text-[10px] px-1.5 h-4 leading-none bg-destructive text-destructive-foreground font-semibold"
              >{{ updateCount }}</Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" class="w-80 p-0">
            <!-- 版本升级 -->
            <div v-if="upgradeStatus?.npm.hasUpdate" class="p-3 border-b border-border">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-4 h-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                <ArrowUpRight class="w-3 h-3" />
              </div>
                <span class="text-sm font-medium">新版本可用</span>
              </div>
              <p class="text-xs text-muted-foreground mb-2">
                {{ upgradeStatus.npm.currentVersion }} → <span class="text-primary font-medium">{{ upgradeStatus.npm.latestVersion }}</span>
              </p>
              <Button
                v-if="upgradeStatus.deployment === 'npm'"
                size="sm" class="w-full text-xs" :disabled="isUpgrading"
                @click="showUpgradeConfirm = true"
              >
                {{ isUpgrading ? '升级中...' : '一键升级' }}
              </Button>
              <div v-else class="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                检测到 {{ upgradeStatus.deployment === 'docker' ? 'Docker' : '未知' }} 部署，请手动更新：
                <code class="block mt-1 text-[10px] bg-amber-100 p-1 rounded">docker pull ghcr.io/zhushanwen321/llm-simple-router:latest</code>
              </div>
            </div>
            <!-- 配置同步 -->
            <div v-if="upgradeStatus?.config.hasUpdate" class="p-3 border-b border-border">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-4 h-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                <RefreshCw class="w-3 h-3" />
              </div>
                <span class="text-sm font-medium">推荐配置已更新</span>
              </div>
              <p class="text-xs text-muted-foreground mb-2">
                供应商或重试规则有新版本
              </p>
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs text-muted-foreground">来源</span>
                <Select :model-value="upgradeStatus?.syncSource" @update:model-value="handleSourceChange">
                  <SelectTrigger class="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="gitee">Gitee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="secondary" class="w-full text-xs" :disabled="isSyncing" @click="handleSync">
                {{ isSyncing ? '同步中...' : '同步配置' }}
              </Button>
            </div>
            <!-- 无更新 -->
            <div v-if="!upgradeStatus?.npm.hasUpdate && !upgradeStatus?.config.hasUpdate" class="p-3">
              <p class="text-xs text-muted-foreground">当前已是最新版本，配置也是最新的</p>
            </div>
            <!-- 底部 -->
            <div class="px-3 py-2 flex justify-between items-center text-xs text-muted-foreground">
              <span>{{ upgradeStatus?.lastCheckedAt ? `检查于 ${new Date(upgradeStatus.lastCheckedAt).toLocaleTimeString()}` : '未检查' }}</span>
              <Button variant="link" class="text-primary h-auto p-0" @click="handleCheckNow">立即检查</Button>
            </div>
          </PopoverContent>
        </Popover>
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
    <!-- 升级确认 -->
    <AlertDialog v-model:open="showUpgradeConfirm">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认升级到 {{ upgradeStatus?.npm.latestVersion }}？</AlertDialogTitle>
          <AlertDialogDescription>
            将执行 <code class="bg-muted px-1 py-0.5 rounded text-xs">npm install -g llm-simple-router@{{ upgradeStatus?.npm.latestVersion }}</code>，升级完成后需要重启服务才能生效。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="handleUpgrade" :disabled="isUpgrading">
            {{ isUpgrading ? '升级中...' : '确认升级' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <!-- 重启确认 -->
    <AlertDialog v-model:open="showRestartConfirm">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>升级成功</AlertDialogTitle>
          <AlertDialogDescription>
            已升级到 {{ upgradeStatus?.npm.latestVersion }}。需要重启服务才能生效。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="showRestartConfirm = false">稍后重启</AlertDialogCancel>
          <AlertDialogAction @click="handleRestart">立即重启</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </aside>
</template>

<script setup lang="ts">
import { type Component, ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUpRight,
  RefreshCw,
  LayoutDashboard,
  Server,
  ArrowLeftRight,
  KeyRound,
  RefreshCcw,
  Sparkles,
  FileText,
  Activity,
  Settings,
  LogOut,
} from 'lucide-vue-next'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'vue-sonner'
import type { AcceptableValue } from 'reka-ui'
import type { UpgradeStatus } from '@/api/client'

const appVersion = __APP_VERSION__

const upgradeStatus = ref<UpgradeStatus | null>(null)
const showUpgradeConfirm = ref(false)
const showRestartConfirm = ref(false)
const isUpgrading = ref(false)
const isSyncing = ref(false)
const isOpen = ref(false)

const POLL_INTERVAL_MS = 5 * 60 * 1000 // eslint-disable-line no-magic-numbers

let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadUpgradeStatus() {
  try {
    upgradeStatus.value = await api.getUpgradeStatus()
  } catch {
    upgradeStatus.value = null
  }
}

async function handleCheckNow() {
  try {
    await api.triggerUpgradeCheck()
    await loadUpgradeStatus()
  } catch { toast.error('检查失败') }
}

async function handleUpgrade() {
  if (!upgradeStatus.value?.npm.latestVersion) return
  isUpgrading.value = true
  try {
    await api.executeUpgrade(upgradeStatus.value.npm.latestVersion)
    toast.success('升级成功')
    showUpgradeConfirm.value = false
    showRestartConfirm.value = true
    await loadUpgradeStatus()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: { message?: string } } } }
    toast.error(err.response?.data?.error?.message || '升级失败')
  } finally {
    isUpgrading.value = false
  }
}

async function handleSync() {
  const source = upgradeStatus.value?.syncSource ?? 'github'
  isSyncing.value = true
  try {
    await api.syncConfig(source)
    toast.success('配置同步成功')
    await loadUpgradeStatus()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: { message?: string } } } }
    toast.error(err.response?.data?.error?.message || '同步失败')
  } finally {
    isSyncing.value = false
  }
}

async function handleSourceChange(val: AcceptableValue) {
  if (typeof val !== 'string') return
  try {
    await api.setSyncSource(val as 'github' | 'gitee')
    await loadUpgradeStatus()
  } catch { toast.error('保存失败') }
}

const updateCount = computed(() => {
  if (!upgradeStatus.value) return 0
  let count = 0
  if (upgradeStatus.value.npm.hasUpdate) count++
  if (upgradeStatus.value.config.hasUpdate) count++
  return count
})

onMounted(() => {
  loadUpgradeStatus()
  pollTimer = setInterval(loadUpgradeStatus, POLL_INTERVAL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

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
  { path: '/settings', label: '系统设置', icon: Settings },
]

const route = useRoute()
const router = useRouter()

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function handleRestart() {
  window.location.reload()
}

async function handleLogout() {
  try {
    await api.logout()
  } finally {
    router.push('/login')
  }
}
</script>
