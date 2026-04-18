import { createRouter, createWebHistory } from 'vue-router'

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
      path: '/logs',
      name: 'logs',
      component: () => import('@/views/Logs.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// 全局 setup 状态缓存
let setupChecked = false
let isSetupInitialized = false

router.beforeEach(async (to, _from, next) => {
  // 已确认初始化，走正常 auth 流程
  if (setupChecked && isSetupInitialized) {
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
    return
  }

  // 检查 setup 状态
  try {
    const { api } = await import('@/api/client')
    const status = await api.getSetupStatus()
    setupChecked = true
    isSetupInitialized = status.initialized

    if (!status.initialized && to.name !== 'setup') {
      next('/setup')
    } else if (status.initialized && to.name === 'setup') {
      next('/login')
    } else if (to.meta.requiresAuth) {
      try {
        await api.getStats()
        next()
      } catch {
        next('/login')
      }
    } else {
      next()
    }
  } catch {
    // API 不可达，放行让后续处理
    next()
  }
})

export default router
