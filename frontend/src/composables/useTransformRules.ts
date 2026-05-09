import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { api, getApiMessage } from '@/api/client'

export function useTransformRules() {
  const { t } = useI18n()
  const transformForm = ref({
    dropFieldsInput: '',
    requestDefaultsInput: '',
    injectHeadersInput: '',
    exists: false,
  })

  async function loadTransformRules(providerId: string) {
    try {
      const res = await api.getTransformRules(providerId)
      if (res) {
        transformForm.value.dropFieldsInput = (res.drop_fields || []).join(', ')
        transformForm.value.requestDefaultsInput = res.request_defaults ? JSON.stringify(res.request_defaults) : ''
        transformForm.value.injectHeadersInput = res.inject_headers ? JSON.stringify(res.inject_headers) : ''
        transformForm.value.exists = true
      } else {
        transformForm.value.dropFieldsInput = ''
        transformForm.value.requestDefaultsInput = ''
        transformForm.value.injectHeadersInput = ''
        transformForm.value.exists = false
      }
    } catch (e) {
      console.error('transformRules.load:', e)
      toast.error(getApiMessage(e, t('providers.transform.loadFailed')))
      transformForm.value.dropFieldsInput = ''
      transformForm.value.requestDefaultsInput = ''
      transformForm.value.injectHeadersInput = ''
      transformForm.value.exists = false
    }
  }

  function saveTransformRules(editingId: string | null) {
    if (!editingId) return Promise.resolve()
    const dropFields = transformForm.value.dropFieldsInput
      ? transformForm.value.dropFieldsInput.split(',').map(s => s.trim()).filter(Boolean)
      : null
    let requestDefaults = null
    if (transformForm.value.requestDefaultsInput.trim()) {
      try { requestDefaults = JSON.parse(transformForm.value.requestDefaultsInput) }
      catch { toast.error(t('providers.transform.requestDefaultsJsonError')); return Promise.resolve() }
    }
    let injectHeaders = null
    if (transformForm.value.injectHeadersInput.trim()) {
      try { injectHeaders = JSON.parse(transformForm.value.injectHeadersInput) }
      catch { toast.error(t('providers.transform.injectHeadersJsonError')); return Promise.resolve() }
    }
    return api.upsertTransformRules(editingId, { drop_fields: dropFields, request_defaults: requestDefaults, inject_headers: injectHeaders, is_active: 1 })
      .then(() => { transformForm.value.exists = true; toast.success(t('providers.transform.saved')) })
      .catch((e) => { console.error('transformRules.save:', e); toast.error(getApiMessage(e, t('common.saveFailed'))) })
  }

  function handleDeleteTransformRules(editingId: string | null) {
    if (!editingId) return Promise.resolve()
    return api.deleteTransformRules(editingId)
      .then(() => {
        transformForm.value.dropFieldsInput = ''
        transformForm.value.requestDefaultsInput = ''
        transformForm.value.injectHeadersInput = ''
        transformForm.value.exists = false
        toast.success(t('providers.transform.deleted'))
      })
      .catch((e) => { console.error('transformRules.delete:', e); toast.error(getApiMessage(e, t('providers.transform.deleteFailed'))) })
  }

  return { transformForm, loadTransformRules, saveTransformRules, handleDeleteTransformRules }
}
