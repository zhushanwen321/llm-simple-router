import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { api, getApiMessage } from '@/api/client'
import type { LogEntry } from '@/components/logs/types'

const PAGE_SIZE = 20
const MS_PER_DAY = 86400000

export function useLogs() {
  const { t } = useI18n()
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

  const totalPages = computed(() => Math.ceil(total.value / PAGE_SIZE))

  /** 加载日志列表。传入 params 会更新内部 filter 状态供 goToPage 复用 */
  async function loadLogs(params?: Record<string, string>) {
    if (params) filterParams.value = params
    try {
      const res = await api.getLogs({ page: page.value, limit: PAGE_SIZE, view: 'grouped', ...filterParams.value })
      logs.value = res.data
      total.value = res.total
      expandedRows.value.clear()
      childLogs.value = {}
      childLoading.value = {}
    } catch (e: unknown) {
      console.error('Failed to load logs:', e)
      toast.error(getApiMessage(e, t('logs.messages.loadFailed')))
    }
  }

  function goToPage(p: number) {
    if (p >= 1 && p <= totalPages.value && p !== page.value) {
      page.value = p
      loadLogs()
    }
  }

  const cleanupResult = ref<number | null>(null)
  const showCleanupResult = ref(false)

  async function handleCleanup() {
    try {
      const before = new Date(Date.now() - cleanupDays.value * MS_PER_DAY).toISOString()
      const res = await api.deleteLogsBefore(before)
      showCleanup.value = false
      page.value = 1
      await loadLogs()
      cleanupResult.value = res.deleted
      showCleanupResult.value = true
    } catch (e: unknown) {
      console.error('Failed to cleanup logs:', e)
      toast.error(getApiMessage(e, t('logs.messages.cleanupFailed')))
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
      } catch (e: unknown) {
        console.error('Failed to load child logs:', e)
        toast.error(getApiMessage(e, t('logs.messages.loadSubRequestsFailed')))
      } finally {
        childLoading.value[id] = false
      }
    }
  }

  async function openLogDetail(id: string) {
    try {
      selectedLogEntry.value = await api.getLogDetail(id)
      logDetailOpen.value = true
    } catch (e: unknown) {
      console.error('Failed to load log detail:', e)
      toast.error(getApiMessage(e, t('logs.messages.loadDetailFailed')))
    }
  }

  return {
    PAGE_SIZE,
    logs, total, page, totalPages,
    cleanupDays, showCleanup, expandedRows, childLogs, childLoading,
    logDetailOpen, selectedLogEntry,
    cleanupResult, showCleanupResult,
    loadLogs, goToPage,
    handleCleanup, toggleExpand, openLogDetail,
  }
}
