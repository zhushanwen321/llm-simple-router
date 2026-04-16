import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/providers',
      name: 'providers',
      component: () => import('@/views/Providers.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('@/views/Metrics.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/mappings',
      name: 'mappings',
      component: () => import('@/views/ModelMappings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/retry-rules',
      name: 'retry-rules',
      component: () => import('@/views/RetryRules.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/router-keys',
      name: 'router-keys',
      component: () => import('@/views/RouterKeys.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('@/views/Logs.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to, _from, next) => {
  if (to.meta.requiresAuth) {
    try {
      const { api } = await import('@/api/client')
      await api.getStats()
      next()
    } catch {
      next('/login')
    }
  } else {
    next()
  }
})

export default router
