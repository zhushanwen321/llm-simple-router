import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'

const DEFAULT_RETENTION_DAYS = 3

export function useLogRetention() {
  const retentionDays = ref(DEFAULT_RETENTION_DAYS)
  const retentionSaving = ref(false)

  async function saveRetention() {
    retentionSaving.value = true
    try {
      const result = await api.setLogRetention(retentionDays.value)
      retentionDays.value = result.days
      toast.success('日志保留天数已更新')
    } catch {
      toast.error('更新保留天数失败')
    } finally {
      retentionSaving.value = false
    }
  }

  async function loadRetention() {
    try {
      const { days } = await api.getLogRetention()
      retentionDays.value = days
    } catch {
      toast.error('加载保留天数失败，使用默认值')
    }
  }

  return {
    retentionDays,
    retentionSaving,
    saveRetention,
    loadRetention,
  }
}
