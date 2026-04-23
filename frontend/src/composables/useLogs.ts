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
  const filterParams = ref<Record<string, string>>({})
  const DEFAULT_CLEANUP_DAYS = 30
  const cleanupDays = ref(DEFAULT_CLEANUP_DAYS)
  const showCleanup = ref(false)

  const expandedRows = ref<Set<string>>(new Set())
  const childLogs = ref<Record<string, LogEntry[]>>({})
  const childLoading = ref<Record<string, boolean>>({})
  const logDetailOpen = ref(false)
  const selectedLogEntry = ref<LogEntry | null>(null)

  const hasMore = computed(() => logs.value.length >= PAGE_SIZE)

  /** 加载日志列表。传入 params 会更新内部 filter 状态供 prevPage/nextPage 复用 */
  async function loadLogs(params?: Record<string, string>) {
    if (params) filterParams.value = params
    try {
      const res = await api.getLogs({ page: page.value, limit: PAGE_SIZE, view: 'grouped', ...filterParams.value })
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

  return {
    PAGE_SIZE,
    logs, total, page, hasMore,
    cleanupDays, showCleanup, expandedRows, childLogs, childLoading,
    logDetailOpen, selectedLogEntry,
    loadLogs, prevPage, nextPage,
    handleCleanup, toggleExpand, openLogDetail,
  }
}
