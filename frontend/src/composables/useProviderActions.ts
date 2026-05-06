import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import type { Provider } from '@/types/mapping'

const MASK_VISIBLE_LEN = 7
const MASK_ASTERISK_COUNT = 7
const COPY_FEEDBACK_MS = 2000

export function useProviderActions() {
  const { t } = useI18n()

  const providers = ref<Provider[]>([])
  const reloading = ref(false)
  const copiedId = ref<string | null>(null)
  const deleteTarget = ref<Provider | null>(null)
  const toggleTarget = ref<Provider | null>(null)
  const pendingToggleId = ref<string | null>(null)
  const pendingToggleActive = ref(false)
  const toggleDependencies = ref<string[]>([])

  async function loadProviders() {
    try {
      providers.value = await api.getProviders()
    } catch (e: unknown) {
      console.error('Failed to load providers:', e)
      toast.error(getApiMessage(e, t('providers.toast.loadFailed')))
    }
  }

  function maskKey(key: string): string {
    if (!key) return ''
    return key.slice(0, MASK_VISIBLE_LEN) + '*'.repeat(MASK_ASTERISK_COUNT)
  }

  async function copyKey(key: string, id: string) {
    await navigator.clipboard.writeText(key)
    copiedId.value = id
    setTimeout(() => { copiedId.value = null }, COPY_FEEDBACK_MS)
  }

  function confirmDelete(p: Provider) { deleteTarget.value = p }

  async function confirmToggle(p: Provider) {
    toggleTarget.value = p
    pendingToggleId.value = p.id
    pendingToggleActive.value = !!p.is_active
    toggleDependencies.value = []
    if (p.is_active) {
      try {
        toggleDependencies.value = (await api.getProviderDependencies(p.id)).references
      } catch { toggleDependencies.value = [] }
    }
  }

  async function handleToggle() {
    const id = pendingToggleId.value
    if (!id) return
    const wasActive = pendingToggleActive.value
    toggleTarget.value = null
    pendingToggleId.value = null
    try {
      const res = await api.updateProvider(id, { is_active: wasActive ? 0 : 1 })
      if (res.cascadedGroups?.length) {
        const disabled = res.cascadedGroups.filter((g: { disabled: boolean }) => g.disabled).length
        const cleaned = res.cascadedGroups.length - disabled
        const parts: string[] = []
        if (cleaned > 0) parts.push(t('providers.toast.cascadeClean', { count: cleaned }))
        if (disabled > 0) parts.push(t('providers.toast.cascadeDisable', { count: disabled }))
        toast.warning(t('providers.toast.cascadeAuto', { actions: parts.join(', ') }))
      }
      await loadProviders()
    } catch (e: unknown) {
      console.error('Failed to toggle provider:', e)
      toast.error(getApiMessage(e, t('providers.toast.toggleFailed')))
    }
  }

  async function handleDelete() {
    const target = deleteTarget.value
    if (!target) return
    deleteTarget.value = null
    try {
      await api.deleteProvider(target.id)
      await loadProviders()
    } catch (e: unknown) {
      toast.error(getApiMessage(e, t('providers.toast.deleteFailed')))
    }
  }

  async function handleReload() {
    reloading.value = true
    try {
      const result = await api.reloadTransformRules()
      toast.success(t('providers.toast.reloadSuccess', { pluginCount: result.loadedPlugins.length, rulesCount: result.rulesCount }))
    } catch (e: unknown) {
      toast.error(getApiMessage(e, t('providers.toast.reloadFailed')))
    } finally {
      reloading.value = false
    }
  }

  return {
    providers, reloading, copiedId,
    deleteTarget, toggleTarget, pendingToggleId, pendingToggleActive, toggleDependencies,
    maskKey, copyKey,
    loadProviders, confirmDelete, confirmToggle, handleToggle,
    handleDelete, handleReload,
  }
}
