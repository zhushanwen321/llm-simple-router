import { ref } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'llm-router-theme'

export const isDark = ref(false)
let initialized = false

function applyTheme(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

function initTheme() {
  if (initialized) return
  initialized = true

  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored === 'dark') {
    applyTheme(true)
  } else {
    applyTheme(false)
  }
}

function toggleTheme() {
  const nextIsDark = !isDark.value
  const next: Theme = nextIsDark ? 'dark' : 'light'
  localStorage.setItem(STORAGE_KEY, String(next))
  applyTheme(nextIsDark)
}

/**
 * Watch for `.dark` class changes on <html> and invoke callback.
 * Used by Chart.js consumers to re-render with correct colors.
 */
export function watchTheme(callback: () => void): () => void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        callback()
        return
      }
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  const stop = () => observer.disconnect()
  return stop
}

export function useTheme() {
  initTheme()

  return {
    isDark,
    toggleTheme,
  }
}

/**
 * Call before Vue mount to apply .dark class and prevent flash.
 * Safe to call multiple times — no-op after first call.
 */
export function initThemeEarly() {
  initTheme()
}
