import { computed } from 'vue'
import { zhCN, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { i18n } from './index'

const LOCALE_MAP: Record<string, Locale> = {
  'zh-CN': zhCN,
  en: enUS,
}

/** Get date-fns locale for current language (reactive) */
export function useDateLocale() {
  const dateLocale = computed(() => LOCALE_MAP[i18n.global.locale.value] ?? zhCN)
  return { dateLocale }
}

export { LOCALE_MAP }
