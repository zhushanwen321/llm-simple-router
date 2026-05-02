import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { api, getApiMessage } from '@/api/client'

const DEFAULT_RETENTION_DAYS = 3

export function useLogRetention() {
  const { t } = useI18n()
  const retentionDays = ref(DEFAULT_RETENTION_DAYS)
  const retentionSaving = ref(false)

  async function saveRetention() {
    retentionSaving.value = true
    try {
      const result = await api.setLogRetention(retentionDays.value)
      retentionDays.value = result.days
      toast.success(t('logs.retention.saved'))
    } catch (e: unknown) {
      toast.error(getApiMessage(e, t('logs.retention.updateFailed')))
    } finally {
      retentionSaving.value = false
    }
  }

  async function loadRetention() {
    try {
      const { days } = await api.getLogRetention()
      retentionDays.value = days
    } catch (e: unknown) {
      toast.error(getApiMessage(e, t('logs.retention.loadFailed')))
    }
  }

  return {
    retentionDays,
    retentionSaving,
    saveRetention,
    loadRetention,
  }
}
