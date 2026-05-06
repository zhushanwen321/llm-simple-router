import { createRouter, createWebHistory } from 'vue-router'
import { api } from '@/api/client'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/views/Setup.vue'),
    },
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
      path: '/proxy-enhancement',
      name: 'proxy-enhancement',
      component: () => import('@/views/ProxyEnhancement.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/schedules',
      name: 'schedules',
      component: () => import('@/views/Schedules.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('@/views/Logs.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/monitor',
      name: 'monitor',
      component: () => import('@/views/Monitor.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/quick-setup',
      name: 'quick-setup',
      component: () => import('@/views/QuickSetup.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// 全局 setup 状态缓存
let setupChecked = false
let isSetupInitialized = false

/** 供 Setup 页面调用：setup 完成后刷新缓存状态 */
export function markSetupDone() {
  setupChecked = true
  isSetupInitialized = true
}

router.beforeEach(async (to, _from, next) => {
  if (!setupChecked) {
    try {
      const status = await api.getSetupStatus()
      setupChecked = true
      isSetupInitialized = status.initialized
      if (!status.initialized && to.name !== 'setup') {
        next('/setup')
        return
      }
      if (status.initialized && to.name === 'setup') {
        next('/login')
        return
      }
    } catch {
      next()
      return
    }
  }

  if (to.meta.requiresAuth && isSetupInitialized) {
    try {
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
