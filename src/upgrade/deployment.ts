import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

export type DeploymentType = 'npm' | 'docker' | 'unknown'

export function detectDeployment(): DeploymentType {
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) {
    return 'docker'
  }
  try {
    execSync('npm --version', { stdio: 'pipe', timeout: 3000 })
    return 'npm'
  } catch {
    return 'unknown'
  }
}
