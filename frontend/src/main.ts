import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { i18n, loadLocaleMessages } from './i18n'
import './style.css'
import { initThemeEarly } from './composables/useTheme'
import { toast } from 'vue-sonner'

// Apply theme before mount to avoid flash of wrong theme
initThemeEarly()

const app = createApp(App)
app.use(router)
app.use(i18n)

app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue global error:', err, { info })
  // 安全提取错误消息：避免 JSON.stringify 循环引用、避免 String() 对非原始类型
  let message = 'Unknown error'
  if (err instanceof Error) {
    message = err.message
  } else if (typeof err === 'string') {
    message = err
  }
  // vue-sonner toast 是独立函数，不依赖组件上下文，在 Toaster 未挂载时静默忽略
  toast.error(message)
}

// 先挂载应用，避免 i18n 加载阻塞首屏
app.mount('#app')

// 异步加载翻译文件
const initLocale = i18n.global.locale.value as 'zh-CN' | 'en'
document.documentElement.setAttribute('lang', initLocale)
loadLocaleMessages(initLocale).catch((e: unknown) => {
  console.error('Failed to load locale messages:', e)
  toast.error('Failed to load language resources')
})
