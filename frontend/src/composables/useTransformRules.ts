import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'

export function useTransformRules() {
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
      toast.error(getApiMessage(e, '加载转换规则失败'))
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
      catch { toast.error('请求默认值 JSON 格式错误'); return Promise.resolve() }
    }
    let injectHeaders = null
    if (transformForm.value.injectHeadersInput.trim()) {
      try { injectHeaders = JSON.parse(transformForm.value.injectHeadersInput) }
      catch { toast.error('注入 Headers JSON 格式错误'); return Promise.resolve() }
    }
    return api.upsertTransformRules(editingId, { drop_fields: dropFields, request_defaults: requestDefaults, inject_headers: injectHeaders, is_active: 1 })
      .then(() => { transformForm.value.exists = true; toast.success('转换规则已保存') })
      .catch((e) => toast.error(getApiMessage(e, '保存失败')))
  }

  function handleDeleteTransformRules(editingId: string | null) {
    if (!editingId) return Promise.resolve()
    return api.deleteTransformRules(editingId)
      .then(() => {
        transformForm.value.dropFieldsInput = ''
        transformForm.value.requestDefaultsInput = ''
        transformForm.value.injectHeadersInput = ''
        transformForm.value.exists = false
        toast.success('转换规则已删除')
      })
      .catch((e) => toast.error(getApiMessage(e, '删除失败')))
  }

  return { transformForm, loadTransformRules, saveTransformRules, handleDeleteTransformRules }
}
