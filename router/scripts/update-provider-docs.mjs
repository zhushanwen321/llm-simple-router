#!/usr/bin/env node

/**
 * 供应商文档自动更新脚本
 *
 * 流程：构建提示词 → claude -p 无头模式 → 解析输出 → 验证 → 差异检测 → 提交 PR
 *
 * 用法：node scripts/update-provider-docs.mjs
 * 前置：claude CLI、gh CLI 已安装并登录
 */

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = resolve(ROOT, 'config/recommended-providers.json')
const DOC_URL_PATH = resolve(ROOT, 'docs/provider/doc_url.json')
const PROMPT_PATH = resolve(ROOT, 'scripts/prompts/update-provider-config.md')
const BRANCH_PREFIX = 'chore/update-provider-docs'
const TARGET_BRANCH = 'develop'
const CLAUDE_TIMEOUT_MS = 600_000

function abort(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

// ── 前置检查 ──────────────────────────────────────

function checkPrerequisites() {
  for (const cmd of ['claude', 'gh', 'git']) {
    try { execSync(`which ${cmd}`, { stdio: 'pipe' }) }
    catch { abort(`缺少命令行工具: ${cmd}`) }
  }
  const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' })
  if (status.trim()) abort('工作树不干净，请先提交或暂存更改')
}

// ── 分支管理 ──────────────────────────────────────

function createBranch() {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const branch = `${BRANCH_PREFIX}-${ts}`
  execSync(`git fetch origin ${TARGET_BRANCH}`, { cwd: ROOT, stdio: 'pipe' })
  try {
    execSync(`git checkout -b ${branch} origin/${TARGET_BRANCH}`, { cwd: ROOT, stdio: 'pipe' })
  } catch {
    const suffix = new Date().toISOString().slice(11, 13) + new Date().toISOString().slice(14, 16)
    const retry = `${branch}-${suffix}`
    execSync(`git checkout -b ${retry} origin/${TARGET_BRANCH}`, { cwd: ROOT, stdio: 'pipe' })
    return retry
  }
  return branch
}

function cleanup(branch) {
  try {
    execSync(`git checkout ${TARGET_BRANCH}`, { cwd: ROOT, stdio: 'pipe' })
    execSync(`git branch -D ${branch}`, { cwd: ROOT, stdio: 'pipe' })
  } catch { /* best effort */ }
}

// ── 构建提示词 ──────────────────────────────────────

function buildPrompt(providers, docUrls) {
  const template = readFileSync(PROMPT_PATH, 'utf-8')
  return template
    .replace('{{CURRENT_PROVIDERS}}', JSON.stringify(providers, null, 2))
    .replace('{{CURRENT_DOC_URLS}}', JSON.stringify(docUrls, null, 2))
}

// ── 调用 Claude CLI ──────────────────────────────────

async function callClaude(prompt) {
  const tmpFile = resolve(ROOT, `.tmp-claude-prompt-${Date.now()}.md`)
  writeFileSync(tmpFile, prompt)

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += d })
      child.stderr.on('data', d => { stderr += d })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('claude -p 超时 (10min)'))
      }, CLAUDE_TIMEOUT_MS)

      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve(stdout)
        else reject(new Error(`claude 退出码 ${code}: ${stderr.slice(0, 500)}`))
      })

      child.stdin.write(prompt)
      child.stdin.end()
    })
  } finally {
    try { unlinkSync(tmpFile) } catch { /* */ }
  }
}

// ── 输出解析 ──────────────────────────────────────

function extractJsonBlock(output, marker) {
  const tagged = new RegExp('```json\\s*\\n//\\s*' + marker + '\\s*\\n([\\s\\S]*?)```')
  const m = output.match(tagged)
  if (m) return m[1].trim()

  const blocks = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)].map(b => b[1].trim())
  if (marker === 'OUTPUT_PROVIDERS') {
    return blocks.find(b => b.startsWith('[')) || null
  }
  return blocks.find(b => b.startsWith('{') && b.includes('"urls"')) || null
}

function parseOutput(output) {
  const providersRaw = extractJsonBlock(output, 'OUTPUT_PROVIDERS')
  const docUrlsRaw = extractJsonBlock(output, 'OUTPUT_DOC_URLS')

  if (!providersRaw && !docUrlsRaw) {
    const debugPath = `/tmp/provider-update-raw-${Date.now()}.txt`
    writeFileSync(debugPath, output)
    abort(`无法从 Claude 输出中提取 JSON，原始输出已保存到 ${debugPath}`)
  }

  return {
    providers: providersRaw ? JSON.parse(providersRaw) : null,
    docUrls: docUrlsRaw ? JSON.parse(docUrlsRaw) : null,
  }
}

// ── 验证 ──────────────────────────────────────────

function validateProviders(data) {
  if (!Array.isArray(data)) abort('providers 必须是数组')
  for (const group of data) {
    if (!group.group || !Array.isArray(group.presets)) abort(`无效的 group: ${JSON.stringify(group).slice(0, 80)}`)
    for (const p of group.presets) {
      if (!p.presetName || !p.baseUrl || !p.models || !p.apiType)
        abort(`无效的 preset: ${JSON.stringify(p).slice(0, 80)}`)
    }
  }
}

function validateDocUrls(data) {
  if (typeof data !== 'object' || data === null) abort('doc_urls 必须是对象')
  for (const [key, val] of Object.entries(data)) {
    if (!val.group || !val.urls) abort(`无效的 doc_url 条目: ${key}`)
  }
}

// ── 提交与 PR ──────────────────────────────────────

function commitAndPR(branch, providersChanged, docUrlsChanged) {
  const files = []
  if (providersChanged) files.push(CONFIG_PATH)
  if (docUrlsChanged) files.push(DOC_URL_PATH)

  execSync(`git add ${files.join(' ')}`, { cwd: ROOT })
  const date = new Date().toISOString().slice(0, 10)
  execSync(`git commit -m "chore: update provider docs and models ${date} [automated]"`, { cwd: ROOT })
  execSync(`git push -u origin ${branch}`, { cwd: ROOT })

  const body = [
    'Automated provider documentation and model list update.',
    '',
    '## Changes',
    `- ${providersChanged ? 'Models updated' : 'Models unchanged'}`,
    `- ${docUrlsChanged ? 'Doc URLs updated' : 'Doc URLs unchanged'}`,
    '',
    'Generated by `scripts/update-provider-docs.mjs`',
  ].join('\n')

  execSync(
    `gh pr create --base ${TARGET_BRANCH} --title "chore: update provider docs and models ${date}" --body ${JSON.stringify(body)}`,
    { cwd: ROOT, encoding: 'utf-8' },
  )
  console.log(`PR created on branch ${branch}`)
}

// ── 主流程 ──────────────────────────────────────

async function main() {
  console.log('1. 前置检查...')
  checkPrerequisites()

  console.log('2. 加载配置...')
  const currentProviders = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  const currentDocUrls = JSON.parse(readFileSync(DOC_URL_PATH, 'utf-8'))

  console.log('3. 创建分支...')
  const branch = createBranch()

  try {
    console.log('4. 构建提示词...')
    const prompt = buildPrompt(currentProviders, currentDocUrls)

    console.log('5. 调用 Claude CLI (可能需要几分钟)...')
    const output = await callClaude(prompt)

    console.log('6. 解析输出...')
    const { providers: newProviders, docUrls: newDocUrls } = parseOutput(output)

    console.log('7. 验证...')
    if (newProviders) validateProviders(newProviders)
    if (newDocUrls) validateDocUrls(newDocUrls)

    const providersChanged = newProviders
      && JSON.stringify(newProviders) !== JSON.stringify(currentProviders)
    const docUrlsChanged = newDocUrls
      && JSON.stringify(newDocUrls) !== JSON.stringify(currentDocUrls)

    if (!providersChanged && !docUrlsChanged) {
      console.log('没有检测到变更。')
      cleanup(branch)
      return
    }

    console.log(`8. 写入更新 (providers: ${!!providersChanged}, docUrls: ${!!docUrlsChanged})...`)
    if (providersChanged) writeFileSync(CONFIG_PATH, JSON.stringify(newProviders, null, 2) + '\n')
    if (docUrlsChanged) writeFileSync(DOC_URL_PATH, JSON.stringify(newDocUrls, null, 2) + '\n')

    console.log('9. 提交并创建 PR...')
    commitAndPR(branch, !!providersChanged, !!docUrlsChanged)
  } catch (err) {
    console.error(`\n✗ 执行失败: ${err.message}`)
    cleanup(branch)
    process.exit(1)
  }
}

main()
