import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import type { LogEntry } from '@/components/logs/types'

const PAGE_SIZE = 20
const MS_PER_DAY = 86400000

export function useLogs() {
  const logs = ref<LogEntry[]>([])
  const total = ref(0)
  const page = ref(1)
  const filterType = ref('all')
  const filterRouterKey = ref('all')
  const routerKeys = ref<{ id: string; name: string }[]>([])
  const cleanupDays = ref(30) // eslint-disable-line no-magic-numbers
  const showCleanup = ref(false)

  const expandedRows = ref<Set<string>>(new Set())
  const childLogs = ref<Record<string, LogEntry[]>>({})
  const childLoading = ref<Record<string, boolean>>({})
  const logDetailOpen = ref(false)
  const selectedLogEntry = ref<LogEntry | null>(null)

  const hasMore = computed(() => logs.value.length >= PAGE_SIZE)

  async function loadLogs() {
    try {
      const params: { page: number; limit: number; api_type?: string; router_key_id?: string; view?: string } = { page: page.value, limit: PAGE_SIZE, view: 'grouped' }
      if (filterType.value && filterType.value !== 'all') params.api_type = filterType.value
      if (filterRouterKey.value && filterRouterKey.value !== 'all') params.router_key_id = filterRouterKey.value
      const res = await api.getLogs(params)
      logs.value = res.data
      total.value = res.total
      expandedRows.value.clear()
      childLogs.value = {}
      childLoading.value = {}
    } catch (e) {
      console.error('Failed to load logs:', e)
      toast.error('加载日志失败')
    }
  }

  function handleFilterChange() {
    page.value = 1
    loadLogs()
  }

  function prevPage() {
    if (page.value > 1) {
      page.value--
      loadLogs()
    }
  }

  function nextPage() {
    page.value++
    loadLogs()
  }

  async function handleCleanup() {
    try {
      const before = new Date(Date.now() - cleanupDays.value * MS_PER_DAY).toISOString()
      const res = await api.deleteLogsBefore(before)
      showCleanup.value = false
      page.value = 1
      await loadLogs()
      toast.success(`已清理 ${res.deleted} 条日志`)
    } catch (e) {
      console.error('Failed to cleanup logs:', e)
      toast.error('清理日志失败')
    }
  }

  async function loadRouterKeys() {
    try {
      const res = await api.getRouterKeys()
      routerKeys.value = res
    } catch (e) {
      console.error('Failed to load router keys:', e)
      toast.error('加载密钥列表失败')
    }
  }

  async function toggleExpand(log: LogEntry) {
    const id = log.id
    if (expandedRows.value.has(id)) {
      expandedRows.value.delete(id)
      return
    }
    expandedRows.value.add(id)
    if (!childLogs.value[id]) {
      childLoading.value[id] = true
      try {
        childLogs.value[id] = await api.getLogChildren(id)
      } catch (e) {
        console.error('Failed to load child logs:', e)
        toast.error('加载子请求失败')
      } finally {
        childLoading.value[id] = false
      }
    }
  }

  async function openLogDetail(id: string) {
    try {
      selectedLogEntry.value = await api.getLogDetail(id)
      logDetailOpen.value = true
    } catch (e) {
      console.error('Failed to load log detail:', e)
      toast.error('加载日志详情失败')
    }
  }

  function init() {
    loadRouterKeys()
    loadLogs()
  }

  return {
    logs, total, page, filterType, filterRouterKey, routerKeys,
    cleanupDays, showCleanup, expandedRows, childLogs, childLoading,
    logDetailOpen, selectedLogEntry, hasMore,
    loadLogs, handleFilterChange, prevPage, nextPage,
    handleCleanup, toggleExpand, openLogDetail, init,
  }
}
