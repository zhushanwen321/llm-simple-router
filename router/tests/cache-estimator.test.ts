import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CacheEstimator } from "../src/routing/cache-estimator.js";
import { encode } from "gpt-tokenizer";

/** TTL for cache entries (30 minutes in milliseconds) */
const TTL_MS = 30 * 60 * 1000;

describe("CacheEstimator", () => {
  let estimator: CacheEstimator;

  beforeEach(() => {
    estimator = new CacheEstimator();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // estimateHit — 正常路径
  // -------------------------------------------------------------------------

  it("estimateHit returns null for first request (no history)", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();
  });

  it("estimateHit returns overlap token count when second request shares prefix", () => {
    const body1 = {
      messages: [{ role: "user", content: "Hello world" }],
    };
    const body2 = {
      messages: [{ role: "user", content: "Hello world, how are you today?" }],
    };

    // 第一个请求：无历史
    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    // 第二个请求：前缀匹配
    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap).not.toBeNull();
    // "Hello world" 是 body2 的完整前缀
    const tokens1 = encode("Hello world");
    expect(overlap!).toBe(tokens1.length);
  });

  it("estimateHit returns full token count when identical body is sent twice", () => {
    const body = {
      messages: [{ role: "user", content: "Hello world, this is a test" }],
    };

    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "gpt-4", body);
    const expectedTokens = encode("Hello world, this is a test").length;
    expect(overlap).toBe(expectedTokens);
  });

  // -------------------------------------------------------------------------
  // estimateHit — 部分重叠
  // -------------------------------------------------------------------------

  it("estimateHit returns count of matching prefix tokens for partial overlap", () => {
    const body1 = {
      messages: [{ role: "user", content: "Hello world" }],
    };
    // 第二个请求：前缀 "Hello world" 后跟完全不同的内容
    const body2 = {
      messages: [
        { role: "user", content: "Hello world banana elephant guitar zzTop" },
      ],
    };

    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap).not.toBeNull();
    // 只有 "Hello world" 的 token 匹配
    const tokens1 = encode("Hello world");
    expect(overlap!).toBe(tokens1.length);
    // 并且应该小于 body2 的总 token 数
    const tokens2 = encode("Hello world banana elephant guitar zzTop");
    expect(overlap!).toBeLessThan(tokens2.length);
  });

  // -------------------------------------------------------------------------
  // estimateHit — 无重叠
  // -------------------------------------------------------------------------

  it("estimateHit returns zero when no prefix tokens match", () => {
    const body1 = {
      messages: [{ role: "user", content: "Tell me about dogs" }],
    };
    const body2 = {
      messages: [{ role: "user", content: "What is the weather?" }],
    };

    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap).toBe(0);
  });

  // -------------------------------------------------------------------------
  // estimateHit — session 隔离
  // -------------------------------------------------------------------------

  it("estimateHit isolates caches by session_id", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };

    // 两个不同 session 的第一次请求都应该是 null
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();
    expect(estimator.estimateHit("sess-2", "gpt-4", body)).toBeNull();

    // sess-1 第二次请求应有历史
    const overlap1 = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(overlap1).not.toBeNull();

    // sess-2 第二次请求应有自己的历史（独立于 sess-1）
    const overlap2 = estimator.estimateHit("sess-2", "gpt-4", body);
    expect(overlap2).not.toBeNull();
  });

  it("estimateHit isolates different sessions with different content", () => {
    const bodyA = { messages: [{ role: "user", content: "AAA" }] };
    const bodyB = { messages: [{ role: "user", content: "BBB" }] };

    // sess-1 存储 "AAA" tokens
    expect(estimator.estimateHit("sess-1", "gpt-4", bodyA)).toBeNull();
    // sess-2 存储 "BBB" tokens
    expect(estimator.estimateHit("sess-2", "gpt-4", bodyB)).toBeNull();

    // sess-1 第二次请求：A vs A → 完全匹配
    const overlap1 = estimator.estimateHit("sess-1", "gpt-4", bodyA);
    expect(overlap1).toBe(encode("AAA").length);

    // sess-2 第二次请求：B vs B → 完全匹配
    const overlap2 = estimator.estimateHit("sess-2", "gpt-4", bodyB);
    expect(overlap2).toBe(encode("BBB").length);
  });

  // -------------------------------------------------------------------------
  // estimateHit — model 隔离
  // -------------------------------------------------------------------------

  it("estimateHit isolates caches by model within same session", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };

    // 同一 session 不同 model：各自独立
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();
    expect(estimator.estimateHit("sess-1", "gpt-3.5-turbo", body)).toBeNull();

    // gpt-4 的第二次请求
    const overlap4 = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(overlap4).not.toBeNull();

    // gpt-3.5-turbo 的第二次请求
    const overlap35 = estimator.estimateHit("sess-1", "gpt-3.5-turbo", body);
    expect(overlap35).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // estimateHit — 顺序请求：每次比较前一次
  // -------------------------------------------------------------------------

  it("estimateHit each request compares against the immediately previous request", () => {
    const body1 = { messages: [{ role: "user", content: "AAA" }] };
    const body2 = { messages: [{ role: "user", content: "BBB" }] };
    const body3 = { messages: [{ role: "user", content: "AAA CCC" }] };

    // 第 1 次：无历史
    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    // 第 2 次：body2("BBB") vs 前一次 body1 的 tokens("AAA")
    // 首 token 不同 → 重叠 0
    const overlap2 = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap2).toBe(0);

    // 第 3 次：body3("AAA CCC") vs 前一次 body2 的 tokens("BBB")
    // 首 token 不同 → 重叠 0（因为比较对象是 body2，不是 body1）
    const overlap3 = estimator.estimateHit("sess-1", "gpt-4", body3);
    expect(overlap3).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 边界条件 — 空 body
  // -------------------------------------------------------------------------

  it("estimateHit handles empty request body (no messages)", () => {
    const body = {} as Record<string, unknown>;

    // 空 body → 提取不出文本 → token 数组为 []
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();

    // 第二次空 body：[] vs [] → 重叠 0
    const overlap = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(overlap).toBe(0);
  });

  it("estimateHit returns zero when second request has empty body after non-empty first", () => {
    const body1 = { messages: [{ role: "user", content: "Hello" }] };
    const body2 = {} as Record<string, unknown>;

    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    // 新 tokens 为 []，prefix match: min(len, 0) = 0 → 重叠 0
    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap).toBe(0);
  });

  it("estimateHit returns zero when first request was empty and second is non-empty", () => {
    const body1 = {} as Record<string, unknown>;
    const body2 = { messages: [{ role: "user", content: "Hello" }] };

    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    // 旧 tokens []，新 tokens 有内容 → min 0 → 重叠 0
    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap).toBe(0);
  });

  // -------------------------------------------------------------------------
  // TTL — auto-cleanup（estimateHit 内触发）
  // -------------------------------------------------------------------------

  it("estimateHit returns null after TTL expires (auto-cleanup on next access)", () => {
    vi.useFakeTimers();

    const body = { messages: [{ role: "user", content: "Hello" }] };

    // 填充缓存
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();

    // 前进 31 分钟（超过 TTL）
    vi.advanceTimersByTime(TTL_MS + 60_000);

    // 下一次调用：过期的历史应被视为无历史
    const result = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(result).toBeNull();
  });

  it("estimateHit returns overlap when TTL has not expired", () => {
    vi.useFakeTimers();

    const body = { messages: [{ role: "user", content: "Hello" }] };
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();

    // 仅前进 15 分钟（小于 TTL）
    vi.advanceTimersByTime(15 * 60_000);

    // 历史应该仍存在，返回完整匹配
    const overlap = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(overlap).not.toBeNull();
    expect(overlap!).toBe(encode("Hello").length);
  });

  it("estimateHit auto-cleanup only removes expired entries, keeps fresh ones", () => {
    vi.useFakeTimers();

    const body = { messages: [{ role: "user", content: "Hi" }] };

    // sess-1 在 T=0 时写入
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();

    // 前进 20 分钟 → sess-2 写入
    vi.advanceTimersByTime(20 * 60_000);
    expect(estimator.estimateHit("sess-2", "gpt-4", body)).toBeNull();

    // 再前进 15 分钟：sess-1 的 entry 已过期（35 分钟），sess-2 未过期（15 分钟）
    vi.advanceTimersByTime(15 * 60_000);

    // sess-2 的访问应触发 auto-cleanup：sess-1 被清理，sess-2 仍有效
    const overlap2 = estimator.estimateHit("sess-2", "gpt-4", body);
    expect(overlap2).not.toBeNull();

    // sess-1 应已被清理，等效于无历史
    const result1 = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(result1).toBeNull();
  });

  // -------------------------------------------------------------------------
  // cleanup — 显式清理
  // -------------------------------------------------------------------------

  it("cleanup removes all expired entries", () => {
    vi.useFakeTimers();

    const body = { messages: [{ role: "user", content: "Hi" }] };

    // 多个 session 写入
    estimator.estimateHit("sess-1", "gpt-4", body);
    estimator.estimateHit("sess-2", "gpt-3.5-turbo", body);

    // 前进超过 TTL
    vi.advanceTimersByTime(TTL_MS + 60_000);

    // 显式清理
    estimator.cleanup();

    // 所有 entry 都应被清理
    expect(estimator.estimateHit("sess-1", "gpt-4", body)).toBeNull();
    expect(estimator.estimateHit("sess-2", "gpt-3.5-turbo", body)).toBeNull();
  });

  it("cleanup does not remove non-expired entries", () => {
    vi.useFakeTimers();

    const body = { messages: [{ role: "user", content: "Hi" }] };
    estimator.estimateHit("sess-1", "gpt-4", body);

    // 仅 10 分钟后
    vi.advanceTimersByTime(10 * 60_000);
    estimator.cleanup();

    // entry 不应被清理
    const overlap = estimator.estimateHit("sess-1", "gpt-4", body);
    expect(overlap).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // tokenization — 长文本全量编码
  // -------------------------------------------------------------------------

  it("tokenizes full text without sampling for long content (>4000 chars)", () => {
    const longText = "The quick brown fox jumps over the lazy dog. ".repeat(150);
    expect(longText.length).toBeGreaterThan(4000);

    const body1 = { messages: [{ role: "user", content: longText }] };
    const body2 = {
      messages: [
        { role: "user", content: longText + " additional text appended" },
      ],
    };

    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);

    // 重叠数应等于 longText 的完整 token 数（证明没有使用采样外推）
    const fullTokens = encode(longText).length;
    expect(overlap).toBe(fullTokens);
  });

  // -------------------------------------------------------------------------
  // tokenization — 多种请求体格式
  // -------------------------------------------------------------------------

  it("tokenizes OpenAI-format body with system prompt", () => {
    const body1 = {
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    };
    const body2 = {
      system: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "What is the capital of France? Give details.",
        },
      ],
    };

    expect(estimator.estimateHit("sess-1", "gpt-4", body1)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "gpt-4", body2);
    expect(overlap).not.toBeNull();
    expect(overlap!).toBeGreaterThan(0);
  });

  it("tokenizes Anthropic-format body with content array", () => {
    const body1 = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello Claude" }] },
      ],
    };
    const body2 = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello Claude, how are you?" },
          ],
        },
      ],
    };

    expect(estimator.estimateHit("sess-1", "claude-sonnet", body1)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "claude-sonnet", body2);
    expect(overlap).not.toBeNull();
    expect(overlap!).toBeGreaterThan(0);
  });

  it("tokenizes body with system as array (Anthropic format)", () => {
    const body1 = {
      system: [{ type: "text", text: "You are a coding expert." }],
      messages: [{ role: "user", content: "Write a function" }],
    };
    const body2 = {
      system: [{ type: "text", text: "You are a coding expert." }],
      messages: [{ role: "user", content: "Write a function that sorts an array" }],
    };

    expect(estimator.estimateHit("sess-1", "claude-sonnet", body1)).toBeNull();

    const overlap = estimator.estimateHit("sess-1", "claude-sonnet", body2);
    expect(overlap).not.toBeNull();
    // 至少 system prompt + "Write a function" 部分 token 重叠
    expect(overlap!).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 单例导出
  // -------------------------------------------------------------------------

  it("exports a cacheEstimator singleton of type CacheEstimator", async () => {
    const mod = await import("../src/routing/cache-estimator.js");
    expect(mod.cacheEstimator).toBeDefined();
    expect(mod.cacheEstimator).toBeInstanceOf(CacheEstimator);
  });
});
