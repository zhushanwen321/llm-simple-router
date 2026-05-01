import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import { initThemeEarly } from './composables/useTheme'

// Apply theme before mount to avoid flash of wrong theme
initThemeEarly()

const app = createApp(App)
app.use(router)
app.mount('#app')
