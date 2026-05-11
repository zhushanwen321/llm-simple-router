import { createI18n } from 'vue-i18n'

const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

const STORAGE_KEY = 'llm-router-locale'
const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'

function getInitialLocale(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && SUPPORTED_LOCALES.includes(stored as SupportedLocale)) {
    return stored as SupportedLocale
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'zh-CN',
  messages: {},
})

/**
 * Dynamically load all module translations for a given locale via import.meta.glob.
 * Called on initial load in main.ts and on locale switch in useLocale.
 */
export async function loadLocaleMessages(locale: SupportedLocale): Promise<void> {
  const modules = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json')
  const localeDir = `./locales/${locale}/`

  const loadJobs = Object.entries(modules)
    .filter(([path]) => path.startsWith(localeDir))
    .map(async ([path, loader]) => {
      const mod = await loader()
      const fileName = path.split('/').pop()!.replace('.json', '')
      return { fileName, messages: mod.default }
    })

  const results = await Promise.allSettled(loadJobs)
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const { fileName, messages } = result.value
    i18n.global.mergeLocaleMessage(locale, { [fileName]: messages })
  }
}

/** Get current locale (type-safe) */
export function getCurrentLocale(): SupportedLocale {
  return i18n.global.locale.value as SupportedLocale
}

export { STORAGE_KEY, SUPPORTED_LOCALES, DEFAULT_LOCALE }
