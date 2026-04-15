import axios from 'axios'
import router from '@/router'

const client = axios.create({
  baseURL: '/admin/api',
  withCredentials: true,
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
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
}

export default client
