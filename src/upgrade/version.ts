import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let cachedVersion: string | null = null

export function getInstalledVersion(): string {
  if (cachedVersion) return cachedVersion
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const pkgPath = path.resolve(__dirname, '../../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  cachedVersion = pkg.version!
  return cachedVersion!
}
