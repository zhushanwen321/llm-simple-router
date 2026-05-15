import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseModels,
  buildModelInfoList,
  clearModelsCache,
  type ModelEntry,
  type ModelInfo,
} from '../src/config/model-context'

describe('model-capabilities', () => {
  beforeEach(() => {
  clearModelsCache()
  })

  // ============================================================
  // parseModels() capabilities 解析
  // ============================================================

  describe('parseModels() capabilities', () => {
  it('parseModels_capabilitiesPresent_returnsExplicitCapabilities', () => {
    // ModelEntry 有显式 capabilities → 原样返回
    const raw = JSON.stringify([
    { name: 'glm-5', patches: [], capabilities: ['text', 'image'] },
    ])
    const result = parseModels(raw)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('glm-5')
    expect(result[0].capabilities).toEqual(['text', 'image'])
  })

  it('parseModels_capabilitiesAbsent_whitelistedModel_getsCapabilitiesFromLookup', () => {
    // gpt-4o 在 MODEL_CAPABILITIES 白名单中 → 自动补充 capabilities
    // 但 JSON 中无 capabilities 字段
    const raw = JSON.stringify([
    { name: 'gpt-4o', patches: [] },
    ])
    const result = parseModels(raw)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('gpt-4o')
    // 期望从 MODEL_CAPABILITIES 白名单补充为 ["text", "image"]
    expect(result[0].capabilities).toEqual(['text', 'image'])
  })

  it('parseModels_capabilitiesAbsent_unknownModel_defaultsToTextOnly', () => {
    // 未知模型不在白名单中 → 默认 ["text"]
    const raw = JSON.stringify([
    { name: 'unknown-model', patches: [] },
    ])
    const result = parseModels(raw)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('unknown-model')
    expect(result[0].capabilities).toEqual(['text'])
  })

  it('parseModels_explicitCapabilitiesNotOverridden_byWhitelist', () => {
    // 显式 capabilities=["text"] 不被白名单覆盖（白名单可能说是 ["text","image"]）
    const raw = JSON.stringify([
    { name: 'gpt-4o', patches: [], capabilities: ['text'] },
    ])
    const result = parseModels(raw)

    expect(result).toHaveLength(1)
    // 显式值优先，不被 MODEL_CAPABILITIES 覆盖
    expect(result[0].capabilities).toEqual(['text'])
  })

  it('parseModels_stringArrayFormat_defaultsToTextForUnknown', () => {
    // 旧格式 string[] → 无 capabilities 字段 → 未知模型默认 ["text"]
    const raw = JSON.stringify(['some-unknown-model'])
    const result = parseModels(raw)

    expect(result).toHaveLength(1)
    expect(result[0].capabilities).toEqual(['text'])
  })

  it('parseModels_multipleModels_mixedCapabilities', () => {
    // 混合场景：有显式、有白名单补充、有默认
    const raw = JSON.stringify([
    { name: 'gpt-4o', patches: [] },                            // 白名单补充
    { name: 'unknown-model', patches: [] },                      // 默认 text
    { name: 'claude-3.5-sonnet', patches: [], capabilities: ['text', 'image', 'video'] },  // 显式
    ])
    const result = parseModels(raw)

    expect(result).toHaveLength(3)
    expect(result[0].capabilities).toEqual(['text', 'image'])          // 白名单
    expect(result[1].capabilities).toEqual(['text'])                   // 默认
    expect(result[2].capabilities).toEqual(['text', 'image', 'video']) // 显式
  })
  })

  // ============================================================
  // buildModelInfoList() capabilities 传递
  // ============================================================

  describe('buildModelInfoList() capabilities passthrough', () => {
  it('buildModelInfoList_passesCapabilitiesThrough', () => {
    const entries: ModelEntry[] = [
    { name: 'gpt-4o', patches: [], capabilities: ['text', 'image'] },
    { name: 'glm-5', patches: [], capabilities: ['text'] },
    ]
    const overrides = new Map<string, number>()
    const result: ModelInfo[] = buildModelInfoList(entries, overrides)

    expect(result).toHaveLength(2)
    expect(result[0].capabilities).toEqual(['text', 'image'])
    expect(result[1].capabilities).toEqual(['text'])
  })

  it('buildModelInfoList_noCapabilities_returnsUndefined', () => {
    // 旧 ModelEntry 无 capabilities → ModelInfo 也不含 capabilities
    const entries: ModelEntry[] = [
    { name: 'glm-5', patches: [] },
    ]
    const overrides = new Map<string, number>()
    const result = buildModelInfoList(entries, overrides)

    expect(result).toHaveLength(1)
    // capabilities 为 undefined（没有该字段）
    expect(result[0].capabilities).toBeUndefined()
  })
  })
})
