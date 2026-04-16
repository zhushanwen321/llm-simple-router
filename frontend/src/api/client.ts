import axios from 'axios'
import router from '@/router'

const client = axios.create({
  baseURL: '/admin/api',
  withCredentials: true,
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) { // eslint-disable-line no-magic-numbers
      router.push('/login')
    }
    return Promise.reject(error)
  }
)

// --- Payload types ---

interface ProviderPayload {
  name: string
  api_type: string
  base_url: string
  api_key?: string
  is_active: number
}

interface MappingPayload {
  client_model: string
  backend_model: string
  provider_id: string
  is_active: number
}

interface RouterKeyCreatePayload {
  name: string
  allowed_models?: string[] | null
}

interface RouterKeyUpdatePayload {
  name?: string
  allowed_models?: string[] | null
  is_active?: number
}

interface MappingGroupPayload {
  client_model: string
  strategy: string
  rule: string  // JSON string
}

interface RetryRulePayload {
  name: string
  status_code: number
  body_pattern: string
  is_active?: number
}

// --- API ---

export const api = {
  login: (password: string) => client.post('/login', { password }),
  logout: () => client.post('/logout'),

  getProviders: () => client.get('/providers'),
  createProvider: (data: ProviderPayload) => client.post('/providers', data),
  updateProvider: (id: string, data: Partial<ProviderPayload>) => client.put(`/providers/${id}`, data),
  deleteProvider: (id: string) => client.delete(`/providers/${id}`),

  getMappings: () => client.get('/mappings'),
  createMapping: (data: MappingPayload) => client.post('/mappings', data),
  updateMapping: (id: string, data: MappingPayload) => client.put(`/mappings/${id}`, data),
  deleteMapping: (id: string) => client.delete(`/mappings/${id}`),

  getLogs: (params: { page: number; limit: number; api_type?: string; router_key_id?: string }) =>
    client.get('/logs', { params }),
  getLogDetail: (id: string) => client.get(`/logs/${id}`),
  deleteLogsBefore: (before: string) =>
    client.delete('/logs/before', { data: { before } }),

  getStats: (params?: { router_key_id?: string }) =>
    client.get('/stats', { params }),

  getMetricsSummary: (params: { period: string; provider_id?: string; backend_model?: string; router_key_id?: string }) =>
    client.get('/metrics/summary', { params }),
  getMetricsTimeseries: (params: { period: string; metric: string; provider_id?: string; backend_model?: string; router_key_id?: string }) =>
    client.get('/metrics/timeseries', { params }),

  getRouterKeys: () => client.get('/router-keys'),
  createRouterKey: (data: RouterKeyCreatePayload) =>
    client.post('/router-keys', data),
  updateRouterKey: (id: string, data: RouterKeyUpdatePayload) =>
    client.put(`/router-keys/${id}`, data),
  deleteRouterKey: (id: string) => client.delete(`/router-keys/${id}`),
  getAvailableModels: () => client.get('/models/available'),

  getMappingGroups: () => client.get('/mapping-groups'),
  createMappingGroup: (data: MappingGroupPayload) =>
    client.post('/mapping-groups', data),
  updateMappingGroup: (id: string, data: MappingGroupPayload) =>
    client.put(`/mapping-groups/${id}`, data),
  deleteMappingGroup: (id: string) => client.delete(`/mapping-groups/${id}`),

  getRetryRules: () => client.get('/retry-rules'),
  createRetryRule: (data: RetryRulePayload) =>
    client.post('/retry-rules', data),
  updateRetryRule: (id: string, data: RetryRulePayload) =>
    client.put(`/retry-rules/${id}`, data),
  deleteRetryRule: (id: string) => client.delete(`/retry-rules/${id}`),
}
