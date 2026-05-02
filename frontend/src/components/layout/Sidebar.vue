<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <aside class="w-56 h-full bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col overflow-hidden">
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
              <div v-else class="text-xs text-warning bg-warning-light p-2 rounded">
                检测到 {{ upgradeStatus.deployment === 'docker' ? 'Docker' : '未知' }} 部署，请手动更新：
                <code class="block mt-1 text-warning bg-warning-dark/10 p-1 rounded">docker pull ghcr.io/zhushanwen321/llm-simple-router:latest</code>
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
              <span>{{ upgradeStatus?.lastCheckedAt ? `检查于 ${parseUtc(upgradeStatus.lastCheckedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '未检查' }}</span>
              <Button variant="link" class="text-primary h-auto p-0" @click="handleCheckNow">立即检查</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
    <nav class="flex-1 p-2 space-y-0.5 overflow-y-auto">
      <template v-for="(group, gIdx) in navGroups" :key="gIdx">
        <!-- Divider between groups -->
        <div v-if="gIdx > 0" class="my-1.5 border-t border-sidebar-border" />

        <!-- Group label (if any) -->
        <div
          v-if="group.label"
          class="flex items-center justify-between px-3 py-1.5"
        >
          <span class="text-[11px] font-medium text-sidebar-foreground/50 uppercase tracking-wider">{{ group.label }}</span>
          <button
            v-if="group.expandable"
            type="button"
            class="flex items-center justify-center w-5 h-5 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors cursor-pointer select-none"
            @click="toggleGroup(gIdx)"
          >
            <ChevronDown
              class="w-3.5 h-3.5 transition-transform duration-200"
              :class="isGroupExpanded(gIdx) ? 'rotate-0' : '-rotate-90'"
            />
          </button>
        </div>

        <!-- Sub-items -->
        <div
          v-if="group.expandable"
          class="overflow-hidden transition-all duration-200 ease-in-out"
          :style="{
            maxHeight: isGroupExpanded(gIdx) ? group.items.length * 44 + 'px' : '0px',
            opacity: isGroupExpanded(gIdx) ? 1 : 0,
          }"
        >
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="flex items-center gap-3 px-3 py-2 ml-1 rounded-lg text-sm transition-colors"
            :class="isActive(item.path) ? 'bg-sidebar-accent text-sidebar-primary' : 'text-sidebar-foreground hover:bg-sidebar-accent'"
          >
            <component :is="item.icon" class="w-4 h-4" />
            {{ item.label }}
          </router-link>
        </div>

        <!-- Non-expandable items (single level) -->
        <template v-if="!group.expandable">
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
            :class="isActive(item.path) ? 'bg-sidebar-accent text-sidebar-primary' : 'text-sidebar-foreground hover:bg-sidebar-accent'"
          >
            <component :is="item.icon" class="w-4 h-4" />
            {{ item.label }}
          </router-link>
        </template>
      </template>
    </nav>
    <div class="p-3 border-t border-sidebar-border space-y-1">
      <Button
        variant="ghost"
        class="w-full justify-start text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
        @click="toggleTheme"
      >
        <Moon v-if="!isDark" class="w-4 h-4" />
        <Sun v-else class="w-4 h-4" />
        {{ isDark ? '浅色模式' : '深色模式' }}
      </Button>
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
import { type Component, ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { parseUtc } from '@/utils/format'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUpRight,
  RefreshCw,
  LayoutDashboard,
  Server,
  ArrowLeftRight,
  KeyRound,
  RefreshCcw,
  FileText,
  Activity,
  Settings,
  LogOut,
  Moon,
  Sun,
  Zap,
  ChevronDown,
} from 'lucide-vue-next'
import { api, getApiMessage } from '@/api/client'
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
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleTheme } = useTheme()

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
  } catch (e: unknown) { toast.error(getApiMessage(e, '检查失败')) }
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
    toast.error(getApiMessage(e, '升级失败'))
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
    toast.error(getApiMessage(e, '同步失败'))
  } finally {
    isSyncing.value = false
  }
}

async function handleSourceChange(val: AcceptableValue) {
  if (typeof val !== 'string') return
  try {
    await api.setSyncSource(val as 'github' | 'gitee')
    await loadUpgradeStatus()
  } catch (e: unknown) { toast.error(getApiMessage(e, '保存失败')) }
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

interface NavGroup {
  label?: string
  items: NavItem[]
  expandable?: boolean
}

// 与 router/index.ts 路由定义保持同步
const navGroups: NavGroup[] = [
  {
    items: [
      { path: '/', label: '仪表盘', icon: LayoutDashboard },
    ],
  },
  {
    label: '代理配置',
    expandable: true,
    items: [
      { path: '/quick-setup', label: '快速配置', icon: Zap },
      { path: '/providers', label: '供应商', icon: Server },
      { path: '/mappings', label: '模型映射', icon: ArrowLeftRight },
      { path: '/router-keys', label: 'API 密钥', icon: KeyRound },
      { path: '/retry-rules', label: '重试规则', icon: RefreshCcw },
    ],
  },
  {
    label: '监控',
    items: [
      { path: '/monitor', label: '实时监控', icon: Activity },
      { path: '/logs', label: '请求日志', icon: FileText },
    ],
  },
  {
    items: [
      { path: '/settings', label: '系统设置', icon: Settings },
    ],
  },
]

const expandedGroups = ref<Set<number>>(new Set([1]))

function isGroupExpanded(index: number): boolean {
  return expandedGroups.value.has(index)
}

function toggleGroup(index: number) {
  const next = new Set(expandedGroups.value)
  if (next.has(index)) {
    next.delete(index)
  } else {
    next.add(index)
  }
  expandedGroups.value = next
}

const route = useRoute()
const router = useRouter()

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

// Auto-expand group when sub-item is active
watch(
  () => route.path,
  () => {
    navGroups.forEach((group, index) => {
      if (!group.expandable) return
      const hasActive = group.items.some(item => isActive(item.path))
      if (hasActive) {
        expandedGroups.value.add(index)
      }
    })
  },
  { immediate: true },
)

async function handleRestart() {
  try {
    await api.restartServer()
    toast.success('重启指令已发送，等待服务恢复...')
    showRestartConfirm.value = false
    // 等待服务重启完成（新进程启动需要几秒）
    const RESTART_DELAY_MS = 5000
    setTimeout(() => {
      window.location.reload()
    }, RESTART_DELAY_MS)
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '重启失败'))
  }
}

async function handleLogout() {
  try {
    await api.logout()
  } finally {
    router.push('/login')
  }
}
</script>
