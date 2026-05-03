import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

export type DeploymentType = 'npm' | 'docker' | 'unknown'
export type RestartMethod = 'process_manager' | 'self_spawn'

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
    // 不缓存 unknown，下次调用时重试检测
    return 'unknown'
  }
}

/**
 * 检测是否有外部进程管理器（PM2 / systemd / Docker）。
 * 有管理器时 process.exit(0) 后会自动重启；没有时需要自 spawn。
 */
export function hasProcessManager(): boolean {
  // Docker — restart policy
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return true
  // PM2 — 注入 pm_id 环境变量
  if (process.env.pm_id !== undefined) return true
  // systemd — 注入 INVOCATION_ID 环境变量
  if (process.env.INVOCATION_ID !== undefined) return true
  return false
}

/**
 * 解析重启时应该使用的可执行文件路径。
 * npx 启动时 process.argv[1] 指向 npm cache 中的旧路径，
 * 升级后全局 bin 已指向新版本，需要重新解析。
 */
export function resolveRestartBinPath(): string {
  try {
    const bin = execSync('which llm-simple-router', {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    if (bin) return bin
  } catch {
    // which 命令不可用或未安装全局包，fallback 到当前进程入口
    return process.argv[1] ?? 'node'
  }
  // fallback: 当前进程入口（PM2/systemd 场景下通常是正确的）
  return process.argv[1]
}

export function getRestartMethod(): RestartMethod {
  return hasProcessManager() ? 'process_manager' : 'self_spawn'
}
