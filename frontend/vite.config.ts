import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const rootVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
).version

export default defineConfig({
  plugins: [vue()],
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
