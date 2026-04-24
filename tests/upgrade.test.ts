import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('detectDeployment', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns docker when /.dockerenv exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: (p: string) => p === '/.dockerenv',
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('docker')
  })

  it('returns docker when /run/.containerenv exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: (p: string) => p === '/run/.containerenv',
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('docker')
  })

  it('returns npm when npm command is available', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: () => false,
    }))
    vi.doMock('node:child_process', () => ({
      execSync: (cmd: string) => {
        if (cmd.startsWith('npm --version')) return Buffer.from('10.0.0\n')
        throw new Error('not found')
      },
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('npm')
  })

  it('returns unknown when no indicators match', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: () => false,
    }))
    vi.doMock('node:child_process', () => ({
      execSync: () => { throw new Error('not found') },
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('unknown')
  })
})

describe('getInstalledVersion', () => {
  it('reads version from package.json', async () => {
    // Restore real node:fs after previous tests mock it
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.doMock('node:fs', () => actualFs)
    const { getInstalledVersion } = await import('../src/upgrade/version')
    const version = getInstalledVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
