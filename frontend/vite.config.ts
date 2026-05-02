import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const rootVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
).version

export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      include: resolve(dirname(fileURLToPath(import.meta.url)), './src/i18n/locales/**'),
      strictMessage: false,
      escapeHtml: false,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
  },
  base: '/admin/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/admin/api': {
        target: 'http://localhost:9980',
        changeOrigin: true
      }
    }
  }
})
