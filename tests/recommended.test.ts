import { describe, it, expect, beforeEach } from 'vitest'
import { loadRecommendedConfig, getRecommendedProviders, getRecommendedRetryRules, reloadConfig } from '../src/config/recommended'
import path from 'path'

const CONFIG_DIR = path.resolve(__dirname, '../config')

describe('recommended config loader', () => {
  beforeEach(() => {
    loadRecommendedConfig(CONFIG_DIR)
  })

  it('loads provider presets from JSON', () => {
    const providers = getRecommendedProviders()
    expect(providers.length).toBeGreaterThan(0)
    expect(providers[0]).toHaveProperty('group')
    expect(providers[0]).toHaveProperty('presets')
    const preset = providers[0].presets[0]
    expect(preset).toHaveProperty('presetName')
    expect(preset).toHaveProperty('apiType')
    expect(preset).toHaveProperty('baseUrl')
    expect(preset).toHaveProperty('models')
    expect(Array.isArray(preset.models)).toBe(true)
  })

  it('loads retry rules from JSON', () => {
    const rules = getRecommendedRetryRules()
    expect(rules.length).toBeGreaterThan(0)
    expect(rules[0]).toHaveProperty('name')
    expect(rules[0]).toHaveProperty('status_code')
    expect(rules[0]).toHaveProperty('body_pattern')
    expect(rules[0]).toHaveProperty('retry_strategy')
  })

  it('returns empty arrays when config dir does not exist', () => {
    loadRecommendedConfig('/nonexistent/path')
    expect(getRecommendedProviders()).toEqual([])
    expect(getRecommendedRetryRules()).toEqual([])
  })

  it('reload refreshes cached data', () => {
    loadRecommendedConfig(CONFIG_DIR)
    const before = getRecommendedProviders()
    reloadConfig()
    const after = getRecommendedProviders()
    expect(after).toEqual(before)
  })
})
