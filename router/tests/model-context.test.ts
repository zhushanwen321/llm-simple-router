import { describe, it, expect } from 'vitest'
import { lookupContextWindow, parseModels, buildModelInfoList, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW, OVERFLOW_THRESHOLD } from '../src/config/model-context'

describe('model-context', () => {
  it('lookupContextWindow returns known value', () => {
    expect(lookupContextWindow('glm-5')).toBe(200000)
    expect(lookupContextWindow('qwen3.6-plus')).toBe(1000000)
  })

  it('lookupContextWindow returns default for unknown', () => {
    expect(lookupContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('parseModels handles string[] format (backward compatible)', () => {
    const result = parseModels('["glm-5","unknown"]')
    expect(result).toEqual([
      { name: 'glm-5', patches: [] },
      { name: 'unknown', patches: [] },
    ])
  })

  it('parseModels handles object[] format with patches (migrates old IDs)', () => {
    const result = parseModels('[{"name":"glm-5","patches":["thinking-param"]},{"name":"deepseek-chat"}]')
    expect(result).toEqual([
      { name: 'glm-5', patches: ['thinking_consistency'] },
      { name: 'deepseek-chat', patches: [] },
    ])
  })

  it('parseModels normalizes object[] without patches', () => {
    const result = parseModels('[{"name":"glm-5","context_window":128000}]')
    expect(result).toEqual([{ name: 'glm-5', patches: [] }])
  })

  it('parseModels handles empty', () => {
    expect(parseModels('[]')).toEqual([])
    expect(parseModels('')).toEqual([])
  })

  it('buildModelInfoList enriches entries with overrides, defaults, and patches', () => {
    const overrides = new Map([['glm-5', 999000]])
    const result = buildModelInfoList([
      { name: 'glm-5', patches: ['thinking_consistency'] },
      { name: 'unknown', patches: [] },
    ], overrides)
    expect(result).toEqual([
      { name: 'glm-5', context_window: 999000, patches: ['thinking_consistency'] },
      { name: 'unknown', context_window: 200000, patches: [] },
    ])
  })

  it('OVERFLOW_THRESHOLD is 1M', () => {
    expect(OVERFLOW_THRESHOLD).toBe(1000000)
  })

  it('has models with 1M context', () => {
    const millionModels = Object.entries(MODEL_CONTEXT_WINDOWS)
      .filter(([, v]) => v >= OVERFLOW_THRESHOLD)
    expect(millionModels.length).toBeGreaterThan(0)
  })
})
