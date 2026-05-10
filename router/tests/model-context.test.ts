import { describe, it, expect, afterEach } from 'vitest'
import { lookupContextWindow, parseModels, buildModelInfoList, MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW, OVERFLOW_THRESHOLD, clearModelsCache } from '../src/config/model-context'

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

  // ============================================================
  // BP-M5: parseModels 缓存测试
  // ============================================================

  describe('parseModels cache', () => {
    afterEach(() => {
      clearModelsCache()
    })

    it('相同 raw 字符串两次调用返回相同引用（缓存命中）', () => {
      const raw = '["glm-5","deepseek-chat"]'
      const result1 = parseModels(raw)
      const result2 = parseModels(raw)
      expect(result1).toBe(result2) // 引用相等 = 缓存命中
    })

    it('不同 raw 字符串返回不同结果', () => {
      const result1 = parseModels('["glm-5"]')
      const result2 = parseModels('["deepseek-chat"]')
      expect(result1).not.toBe(result2)
      expect(result1[0].name).toBe('glm-5')
      expect(result2[0].name).toBe('deepseek-chat')
    })

    it('空字符串返回空数组', () => {
      const result = parseModels('')
      expect(result).toEqual([])
    })

    it('无效 JSON 返回空数组', () => {
      const result = parseModels('not json')
      expect(result).toEqual([])
    })

    it('缓存结果内容正确（含 patches 迁移）', () => {
      const raw = '[{"name":"glm-5","patches":["thinking-param"]}]'
      const result = parseModels(raw)
      expect(result).toEqual([{ name: 'glm-5', patches: ['thinking_consistency'] }])
      // 第二次调用也应返回相同结果
      const result2 = parseModels(raw)
      expect(result2).toEqual([{ name: 'glm-5', patches: ['thinking_consistency'] }])
    })
  })
})
