import { describe, it, expect, beforeEach } from "vitest";
import {
  parseModels,
  clearModelsCache,
  type ModelEntry,
} from "../../src/config/model-context.js";
import {
  getModelTimeouts,
  getModelStreamTimeout,
  DEFAULT_STREAM_TIMEOUT_MS,
  DEFAULT_NON_STREAM_TIMEOUT_MS,
  type Provider,
} from "../../src/db/providers.js";

// 构造最小 Provider（getModelTimeouts 只读 models 字段）
function makeProvider(modelsJson: string): Provider {
  return { models: modelsJson } as Provider;
}

describe("getModelTimeouts", () => {
  beforeEach(() => {
    clearModelsCache();
  });

  it("返回配置的 stream/nonStream 值", () => {
    const provider = makeProvider(
      JSON.stringify([
        { id: "glm-5.1", stream_timeout_ms: 12_000, non_stream_timeout_ms: 34_000 },
      ]),
    );
    expect(getModelTimeouts(provider, "glm-5.1")).toEqual({
      stream: 12_000,
      nonStream: 34_000,
    });
  });

  it("未配置返回默认值 300000/600000", () => {
    const provider = makeProvider(JSON.stringify([{ id: "glm-5.1" }]));
    const result = getModelTimeouts(provider, "glm-5.1");
    expect(result.stream).toBe(DEFAULT_STREAM_TIMEOUT_MS);
    expect(result.nonStream).toBe(DEFAULT_NON_STREAM_TIMEOUT_MS);
    expect(DEFAULT_STREAM_TIMEOUT_MS).toBe(300_000);
    expect(DEFAULT_NON_STREAM_TIMEOUT_MS).toBe(600_000);
  });

  it("模型不存在于 provider 时返回默认值", () => {
    const provider = makeProvider(
      JSON.stringify([{ id: "other", stream_timeout_ms: 5_000, non_stream_timeout_ms: 9_000 }]),
    );
    expect(getModelTimeouts(provider, "glm-5.1")).toEqual({
      stream: DEFAULT_STREAM_TIMEOUT_MS,
      nonStream: DEFAULT_NON_STREAM_TIMEOUT_MS,
    });
  });

  it("stream=0 → stream=Infinity", () => {
    const provider = makeProvider(
      JSON.stringify([{ id: "glm-5.1", stream_timeout_ms: 0, non_stream_timeout_ms: 10_000 }]),
    );
    expect(getModelTimeouts(provider, "glm-5.1").stream).toBe(Number.POSITIVE_INFINITY);
    expect(getModelTimeouts(provider, "glm-5.1").nonStream).toBe(10_000);
  });

  it("nonStream=0 → nonStream=Infinity", () => {
    const provider = makeProvider(
      JSON.stringify([{ id: "glm-5.1", stream_timeout_ms: 10_000, non_stream_timeout_ms: 0 }]),
    );
    expect(getModelTimeouts(provider, "glm-5.1").stream).toBe(10_000);
    expect(getModelTimeouts(provider, "glm-5.1").nonStream).toBe(Number.POSITIVE_INFINITY);
  });

  it("仅配置 stream，nonStream 回退默认", () => {
    const provider = makeProvider(
      JSON.stringify([{ id: "glm-5.1", stream_timeout_ms: 7_000 }]),
    );
    expect(getModelTimeouts(provider, "glm-5.1")).toEqual({
      stream: 7_000,
      nonStream: DEFAULT_NON_STREAM_TIMEOUT_MS,
    });
  });

  it("getModelStreamTimeout 薄包装与 getModelTimeouts().stream 一致", () => {
    const provider = makeProvider(
      JSON.stringify([{ id: "glm-5.1", stream_timeout_ms: 42_000, non_stream_timeout_ms: 99_000 }]),
    );
    expect(getModelStreamTimeout(provider, "glm-5.1")).toBe(
      getModelTimeouts(provider, "glm-5.1").stream,
    );
  });

  it("models 为空数组返回默认值", () => {
    const provider = makeProvider("[]");
    expect(getModelTimeouts(provider, "any")).toEqual({
      stream: DEFAULT_STREAM_TIMEOUT_MS,
      nonStream: DEFAULT_NON_STREAM_TIMEOUT_MS,
    });
  });

  it("models 非法 JSON 返回默认值", () => {
    const provider = makeProvider("not-json");
    expect(getModelTimeouts(provider, "any")).toEqual({
      stream: DEFAULT_STREAM_TIMEOUT_MS,
      nonStream: DEFAULT_NON_STREAM_TIMEOUT_MS,
    });
  });
});

describe("parseModels 解析 non_stream_timeout_ms", () => {
  beforeEach(() => {
    clearModelsCache();
  });

  it("从对象形式（name）解析 non_stream_timeout_ms", () => {
    const entries = parseModels(
      JSON.stringify([{ name: "glm-5.1", stream_timeout_ms: 11_000, non_stream_timeout_ms: 22_000 }]),
    );
    expect(entries).toHaveLength(1);
    const entry: ModelEntry = entries[0];
    expect(entry.name).toBe("glm-5.1");
    expect(entry.stream_timeout_ms).toBe(11_000);
    expect(entry.non_stream_timeout_ms).toBe(22_000);
  });

  it("从对象形式（id）解析 non_stream_timeout_ms", () => {
    const entries = parseModels(
      JSON.stringify([{ id: "glm-5.1", non_stream_timeout_ms: 33_000 }]),
    );
    expect(entries[0].non_stream_timeout_ms).toBe(33_000);
    expect(entries[0].stream_timeout_ms).toBeUndefined();
  });

  it("未提供 non_stream_timeout_ms 时字段为 undefined", () => {
    const entries = parseModels(JSON.stringify([{ name: "glm-5.1", stream_timeout_ms: 11_000 }]));
    expect(entries[0].non_stream_timeout_ms).toBeUndefined();
  });

  it("字符串形式模型不携带超时字段", () => {
    const entries = parseModels(JSON.stringify(["glm-5.1"]));
    expect(entries[0].non_stream_timeout_ms).toBeUndefined();
    expect(entries[0].stream_timeout_ms).toBeUndefined();
  });
});
