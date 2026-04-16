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

// --- API endpoint constants ---

const API = {
  LOGIN: '/login',
  LOGOUT: '/logout',
  PROVIDERS: '/providers',
  MAPPINGS: '/mappings',
  MAPPING_GROUPS: '/mapping-groups',
  RETRY_RULES: '/retry-rules',
  LOGS: '/logs',
  STATS: '/stats',
  METRICS_SUMMARY: '/metrics/summary',
  METRICS_TIMESERIES: '/metrics/timeseries',
  ROUTER_KEYS: '/router-keys',
  MODELS_AVAILABLE: '/models/available',
} as const

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
  login: (password: string) => client.post(API.LOGIN, { password }),
  logout: () => client.post(API.LOGOUT),

  getProviders: () => client.get(API.PROVIDERS),
  createProvider: (data: ProviderPayload) => client.post(API.PROVIDERS, data),
  updateProvider: (id: string, data: Partial<ProviderPayload>) => client.put(`${API.PROVIDERS}/${id}`, data),
  deleteProvider: (id: string) => client.delete(`${API.PROVIDERS}/${id}`),

  getMappings: () => client.get(API.MAPPINGS),
  createMapping: (data: MappingPayload) => client.post(API.MAPPINGS, data),
  updateMapping: (id: string, data: MappingPayload) => client.put(`${API.MAPPINGS}/${id}`, data),
  deleteMapping: (id: string) => client.delete(`${API.MAPPINGS}/${id}`),

  getLogs: (params: { page: number; limit: number; api_type?: string; router_key_id?: string }) =>
    client.get(API.LOGS, { params }),
  getLogDetail: (id: string) => client.get(`${API.LOGS}/${id}`),
  deleteLogsBefore: (before: string) =>
    client.delete(`${API.LOGS}/before`, { data: { before } }),

  getStats: (params?: { router_key_id?: string }) =>
    client.get(API.STATS, { params }),

  getMetricsSummary: (params: { period: string; provider_id?: string; backend_model?: string; router_key_id?: string }) =>
    client.get(API.METRICS_SUMMARY, { params }),
  getMetricsTimeseries: (params: { period: string; metric: string; provider_id?: string; backend_model?: string; router_key_id?: string }) =>
    client.get(API.METRICS_TIMESERIES, { params }),

  getRouterKeys: () => client.get(API.ROUTER_KEYS),
  createRouterKey: (data: RouterKeyCreatePayload) =>
    client.post(API.ROUTER_KEYS, data),
  updateRouterKey: (id: string, data: RouterKeyUpdatePayload) =>
    client.put(`${API.ROUTER_KEYS}/${id}`, data),
  deleteRouterKey: (id: string) => client.delete(`${API.ROUTER_KEYS}/${id}`),
  getAvailableModels: () => client.get(API.MODELS_AVAILABLE),

  getMappingGroups: () => client.get(API.MAPPING_GROUPS),
  createMappingGroup: (data: MappingGroupPayload) =>
    client.post(API.MAPPING_GROUPS, data),
  updateMappingGroup: (id: string, data: MappingGroupPayload) =>
    client.put(`${API.MAPPING_GROUPS}/${id}`, data),
  deleteMappingGroup: (id: string) => client.delete(`${API.MAPPING_GROUPS}/${id}`),

  getRetryRules: () => client.get(API.RETRY_RULES),
  createRetryRule: (data: RetryRulePayload) =>
    client.post(API.RETRY_RULES, data),
  updateRetryRule: (id: string, data: RetryRulePayload) =>
    client.put(`${API.RETRY_RULES}/${id}`, data),
  deleteRetryRule: (id: string) => client.delete(`${API.RETRY_RULES}/${id}`),
}
