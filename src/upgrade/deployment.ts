import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

export type DeploymentType = 'npm' | 'docker' | 'unknown'

let cachedDeployment: DeploymentType | null = null

export function detectDeployment(): DeploymentType {
  if (cachedDeployment) return cachedDeployment
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) {
    cachedDeployment = 'docker'
    return cachedDeployment
  }
  try {
    execSync('npm --version', { stdio: 'pipe', timeout: 3000 })
    cachedDeployment = 'npm'
    return cachedDeployment
  } catch {
    cachedDeployment = 'unknown'
    return cachedDeployment
  }
}
