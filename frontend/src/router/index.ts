import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/admin/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/admin/',
      name: 'dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/providers',
      name: 'providers',
      component: () => import('@/views/Providers.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/mappings',
      name: 'mappings',
      component: () => import('@/views/ModelMappings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/logs',
      name: 'logs',
      component: () => import('@/views/Logs.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to, _from, next) => {
  if (to.meta.requiresAuth) {
    try {
      const axios = (await import('@/api/client')).default
      await axios.get('/stats')
      next()
    } catch {
      next('/admin/login')
    }
  } else {
    next()
  }
})

export default router
