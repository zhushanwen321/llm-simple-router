import { describe, it, expect } from 'vitest'
import { lookupContextWindow, parseModels, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW, COMPACT_THRESHOLD } from '../src/config/model-context'

describe('model-context', () => {
  it('lookupContextWindow returns known value', () => {
    expect(lookupContextWindow('glm-5')).toBe(200000)
    expect(lookupContextWindow('qwen3.6-plus')).toBe(1000000)
  })

  it('lookupContextWindow returns default for unknown', () => {
    expect(lookupContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('parseModels handles old string[] format', () => {
    const result = parseModels('["glm-5","unknown"]')
    expect(result).toEqual([
      { name: 'glm-5', context_window: 200000 },
      { name: 'unknown', context_window: 200000 },
    ])
  })

  it('parseModels handles new object[] format', () => {
    const result = parseModels('[{"name":"glm-5","context_window":128000}]')
    expect(result).toEqual([{ name: 'glm-5', context_window: 128000 }])
  })

  it('parseModels handles empty', () => {
    expect(parseModels('[]')).toEqual([])
    expect(parseModels('')).toEqual([])
  })

  it('COMPACT_THRESHOLD is 1M', () => {
    expect(COMPACT_THRESHOLD).toBe(1000000)
  })

  it('has models with 1M context', () => {
    const millionModels = Object.entries(MODEL_CONTEXT_WINDOWS)
      .filter(([, v]) => v >= COMPACT_THRESHOLD)
    expect(millionModels.length).toBeGreaterThan(0)
  })
})
