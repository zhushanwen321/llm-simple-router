import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

// Initialize theme before mount to avoid flash
;(function initTheme() {
  const stored = localStorage.getItem('llm-router-theme')
  if (stored === 'dark') {
    document.documentElement.classList.add('dark')
  }
})()

const app = createApp(App)
app.use(router)
app.mount('#app')
