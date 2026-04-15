import axios from 'axios'
import router from '@/router'

/* eslint-disable @typescript-eslint/no-explicit-any */

const client = axios.create({
  baseURL: '/admin/api',
  withCredentials: true,
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) { // eslint-disable-line no-magic-numbers
      router.push('/admin/login')
    }
    return Promise.reject(error)
  }
)

export const api = {
  login: (password: string) => client.post('/login', { password }),
  logout: () => client.post('/logout'),

  getProviders: () => client.get('/providers'),
  createProvider: (data: any) => client.post('/providers', data),
  updateProvider: (id: string, data: any) => client.put(`/providers/${id}`, data),
  deleteProvider: (id: string) => client.delete(`/providers/${id}`),

  getMappings: () => client.get('/mappings'),
  createMapping: (data: any) => client.post('/mappings', data),
  updateMapping: (id: string, data: any) => client.put(`/mappings/${id}`, data),
  deleteMapping: (id: string) => client.delete(`/mappings/${id}`),

  getLogs: (params: { page: number; limit: number; api_type?: string }) =>
    client.get('/logs', { params }),
  getLogDetail: (id: string) => client.get(`/logs/${id}`),
  deleteLogsBefore: (before: string) =>
    client.delete('/logs/before', { data: { before } }),

  getStats: () => client.get('/stats'),

  getMetricsSummary: (params: { period: string; provider_id?: string; backend_model?: string }) =>
    client.get('/metrics/summary', { params }),
  getMetricsTimeseries: (params: { period: string; metric: string; provider_id?: string; backend_model?: string }) =>
    client.get('/metrics/timeseries', { params }),
}

export default client
