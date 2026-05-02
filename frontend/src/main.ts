import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { i18n, loadLocaleMessages } from './i18n'
import './style.css'
import { initThemeEarly } from './composables/useTheme'

// Apply theme before mount to avoid flash of wrong theme
initThemeEarly()

const app = createApp(App)
app.use(router)
app.use(i18n)

// Load translations for current locale before mounting
const initLocale = i18n.global.locale.value as 'zh-CN' | 'en'
document.documentElement.setAttribute('lang', initLocale)
loadLocaleMessages(initLocale).then(() => {
  app.mount('#app')
})
