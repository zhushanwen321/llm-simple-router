import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadLocaleMessages, STORAGE_KEY, type SupportedLocale } from '@/i18n'

/**
 * Locale switching composable.
 * - locale: current locale (reactive)
 * - setLocale: switch language, persist to localStorage, load translations
 * - localeLabel: display name for current language
 * - toggleTarget: the locale to switch to
 */
export function useLocale() {
  const { locale } = useI18n()

  async function setLocale(lang: SupportedLocale) {
    locale.value = lang
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.setAttribute('lang', lang)
    await loadLocaleMessages(lang)
  }

  const localeLabel = computed(() => {
    return locale.value === 'zh-CN' ? '中文' : 'EN'
  })

  const toggleTarget = computed<SupportedLocale>(() => {
    return locale.value === 'zh-CN' ? 'en' : 'zh-CN'
  })

  return { locale, setLocale, localeLabel, toggleTarget }
}
