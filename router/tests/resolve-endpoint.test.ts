import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/utils/crypto.js";

// TDD 红色阶段：函数尚未实现，导入路径对应最终实现位置
import {
  parseEndpoints,
  serializeEndpoints,
} from "../src/db/providers.js";
import { resolveEndpoint } from "../src/proxy/routing/resolve-endpoint.js";
import type { Provider } from "../src/db/providers.js";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------------------------------------------------------------------------
// parseEndpoints
// ---------------------------------------------------------------------------
describe("parseEndpoints", () => {
  it("null → 空数组", () => {
    expect(parseEndpoints(null)).toEqual([]);
  });

  it("undefined → 空数组", () => {
    expect(parseEndpoints(undefined)).toEqual([]);
  });

  it("空字符串 → 空数组", () => {
    expect(parseEndpoints("")).toEqual([]);
  });

  it("有效 JSON 数组 → 返回解析结果", () => {
    const input = JSON.stringify([
      { api_type: "openai", base_url: "https://api.openai.com" },
    ]);
    const result = parseEndpoints(input);
    expect(result).toHaveLength(1);
    expect(result[0].api_type).toBe("openai");
    expect(result[0].base_url).toBe("https://api.openai.com");
  });

  it("多元素 JSON 数组 → 保留全部元素", () => {
    const input = JSON.stringify([
      { api_type: "openai", base_url: "https://a.com" },
      { api_type: "anthropic", base_url: "https://b.com" },
      { api_type: "openai-responses", base_url: "https://c.com" },
    ]);
    expect(parseEndpoints(input)).toHaveLength(3);
  });

  it("非法 JSON → throw Error", () => {
    expect(() => parseEndpoints("not-json")).toThrow();
  });

  it('"[null]" 格式错误的 JSON → throw Error', () => {
    expect(() => parseEndpoints("[null]")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// serializeEndpoints
// ---------------------------------------------------------------------------
describe("serializeEndpoints", () => {
  it("空数组 → '[]'", () => {
    expect(serializeEndpoints([])).toBe("[]");
  });

  it("正常序列化", () => {
    const endpoints = [
      { api_type: "openai" as const, base_url: "https://api.openai.com" },
    ];
    const json = serializeEndpoints(endpoints);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].api_type).toBe("openai");
  });

  it("往返一致：serialize → parse → 值相等", () => {
    const original = [
      {
        api_type: "openai-responses" as const,
        base_url: "https://api.openai.com",
        upstream_path: "/v1/responses",
        api_key: "encrypted-key",
      },
      {
        api_type: "anthropic" as const,
        base_url: "https://api.anthropic.com",
      },
    ];
    const roundTripped = parseEndpoints(serializeEndpoints(original));
    expect(roundTripped).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// resolveEndpoint — 行为表 10 个场景
// ---------------------------------------------------------------------------

/** 构造最小化 Provider 对象 */
function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p1",
    name: "test-provider",
    api_type: "openai",
    base_url: "https://default.example.com",
    upstream_path: null,
    api_key: encrypt("sk-provider-key", TEST_KEY),
    models: "[]",
    is_active: 1,
    max_concurrency: 0,
    queue_timeout_ms: 0,
    max_queue_size: 100,
    adaptive_enabled: 0,
    proxy_type: null,
    proxy_url: null,
    proxy_username: null,
    proxy_password: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveEndpoint — 行为表", () => {
  // --- 场景 1: 单 endpoint + 精确匹配 → needs_transform=false ---
  it("场景1: 单 endpoint + 精确匹配 → needs_transform=false", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.api_type).toBe("openai");
    expect(result.base_url).toBe("https://api.openai.com");
    expect(result.needs_transform).toBe(false);
    expect(result.api_key).toBe("sk-provider-key");
  });

  // --- 场景 2: 单 endpoint + 不匹配 → needs_transform=true, 用第一个 ---
  it("场景2: 单 endpoint + 不匹配 → needs_transform=true, fallback 到第一个", () => {
    const provider = makeProvider({
      api_type: "openai",
      endpoints: serializeEndpoints([
        { api_type: "anthropic", base_url: "https://api.anthropic.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.api_type).toBe("anthropic");
    expect(result.base_url).toBe("https://api.anthropic.com");
    expect(result.needs_transform).toBe(true);
  });

  // --- 场景 3: 多 endpoint + 精确匹配第一个 ---
  it("场景3: 多 endpoint + 精确匹配第一个 → needs_transform=false", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
        { api_type: "anthropic", base_url: "https://api.anthropic.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.api_type).toBe("openai");
    expect(result.base_url).toBe("https://api.openai.com");
    expect(result.needs_transform).toBe(false);
  });

  // --- 场景 4: 多 endpoint + 精确匹配第二个 ---
  it("场景4: 多 endpoint + 精确匹配第二个 → needs_transform=false", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
        { api_type: "anthropic", base_url: "https://api.anthropic.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "anthropic", TEST_KEY);
    expect(result.api_type).toBe("anthropic");
    expect(result.base_url).toBe("https://api.anthropic.com");
    expect(result.needs_transform).toBe(false);
  });

  // --- 场景 5: 含 openai-responses + 精确匹配 ---
  it("场景5: openai-responses endpoint + 精确匹配 → needs_transform=false", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
        { api_type: "openai-responses", base_url: "https://api.openai.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "openai-responses", TEST_KEY);
    expect(result.api_type).toBe("openai-responses");
    expect(result.base_url).toBe("https://api.openai.com");
    expect(result.needs_transform).toBe(false);
  });

  // --- 场景 6: openai-responses 客户端 + 只有 openai endpoint → needs_transform=true ---
  it("场景6: openai-responses 客户端 + 只有 openai endpoint → needs_transform=true", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "openai-responses", TEST_KEY);
    expect(result.api_type).toBe("openai");
    expect(result.base_url).toBe("https://api.openai.com");
    expect(result.needs_transform).toBe(true);
  });

  // --- 场景 7: endpoint 有独立 api_key → 解密后使用 ---
  it("场景7: endpoint 独立 api_key → 解密后使用（非 provider 级 key）", () => {
    const endpointApiKey = encrypt("sk-endpoint-specific-key", TEST_KEY);
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        {
          api_type: "openai",
          base_url: "https://api.openai.com",
          api_key: endpointApiKey,
        },
      ]),
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.api_key).toBe("sk-endpoint-specific-key");
    expect(result.api_key).not.toBe("sk-provider-key");
  });

  // --- 场景 8: endpoint api_key=null → fallback 到 provider.api_key ---
  it("场景8: endpoint api_key=null → fallback 到 provider.api_key", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        {
          api_type: "openai",
          base_url: "https://api.openai.com",
          api_key: null,
        },
      ]),
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.api_key).toBe("sk-provider-key");
  });

  // --- 场景 9: 空数组 → 回退到 provider 级别字段 ---
  it("场景9: 空数组 → 回退到 provider 级别字段", () => {
    const provider = makeProvider({
      endpoints: "[]",
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.api_type).toBe("openai");
    expect(result.base_url).toBe("https://default.example.com");
    expect(result.needs_transform).toBe(false);
  });

  // --- 场景 10: needs_transform 基于 clientApiType !== endpoint.api_type ---
  it("场景10: needs_transform 当 clientApiType !== endpoint.api_type", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
      ]),
    });

    // 精确匹配 → false
    const match = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(match.needs_transform).toBe(false);

    // 不匹配 → true（需要从 openai 转换到 anthropic 格式）
    const mismatch = resolveEndpoint(provider, "anthropic", TEST_KEY);
    expect(mismatch.needs_transform).toBe(true);
    // 确认是 fallback 到第一个 endpoint
    expect(mismatch.api_type).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// resolveEndpoint — upstream_path 处理
// ---------------------------------------------------------------------------
describe("resolveEndpoint — upstream_path", () => {
  it("endpoint 有 upstream_path → 透传", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        {
          api_type: "openai-responses",
          base_url: "https://api.openai.com",
          upstream_path: "/v1/responses",
        },
      ]),
    });

    const result = resolveEndpoint(provider, "openai-responses", TEST_KEY);
    expect(result.upstream_path).toBe("/v1/responses");
  });

  it("endpoint 无 upstream_path → null", () => {
    const provider = makeProvider({
      endpoints: serializeEndpoints([
        { api_type: "openai", base_url: "https://api.openai.com" },
      ]),
    });

    const result = resolveEndpoint(provider, "openai", TEST_KEY);
    expect(result.upstream_path).toBeNull();
  });
});
