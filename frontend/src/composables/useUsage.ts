import { ref, watch, type Ref } from 'vue'
import { api, type UsageWindowWithUsage, type DailyUsage } from '@/api/client'

export function useUsage(keyFilter: Ref<string>) {
  const usageTab = ref('windows')
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
      if (usageTab.value === 'windows') {
        windowsData.value = await api.getUsageWindows(params)
      } else if (usageTab.value === 'weekly') {
        weeklyData.value = await api.getUsageWeekly(params)
      } else {
        monthlyData.value = await api.getUsageMonthly(params)
      }
    } catch {
      usageError.value = '加载用量数据失败'
    } finally {
      usageLoading.value = false
    }
  }

  watch(usageTab, fetchUsage)
  watch(keyFilter, fetchUsage)

  return { usageTab, windowsData, weeklyData, monthlyData, usageLoading, usageError, fetchUsage }
}
