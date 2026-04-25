import { ref, watch, type Ref } from 'vue'
import { api, getApiMessage, type UsageWindowWithUsage, type DailyUsage } from '@/api/client'

export function useUsage(keyFilter: Ref<string>, period: Ref<string>) {
  const windowsData = ref<UsageWindowWithUsage[]>([])
  const weeklyData = ref<DailyUsage[]>([])
  const monthlyData = ref<DailyUsage[]>([])
  const usageLoading = ref(false)
  const usageError = ref('')

  async function fetchUsage() {
    usageLoading.value = true
    usageError.value = ''
    const params = keyFilter.value !== 'all' ? { router_key_id: keyFilter.value } : {}
    try {
      if (period.value === 'window') {
        windowsData.value = await api.getUsageWindows(params)
      } else if (period.value === 'weekly') {
        weeklyData.value = await api.getUsageWeekly(params)
      } else if (period.value === 'monthly') {
        monthlyData.value = await api.getUsageMonthly(params)
      }
    } catch (e: unknown) {
      usageError.value = getApiMessage(e, '加载用量数据失败')
    } finally {
      usageLoading.value = false
    }
  }

  watch(period, fetchUsage)
  watch(keyFilter, fetchUsage)

  return { windowsData, weeklyData, monthlyData, usageLoading, usageError, fetchUsage }
}
