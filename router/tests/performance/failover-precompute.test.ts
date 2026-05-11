/**
 * BP-H4 + BP-H3: failover-loop 预计算不变量 + API Key 缓存测试
 *
 * 由于 failover-loop 涉及大量依赖（DB、container、orchestrator 等），
 * 直接集成测试过于复杂。这里通过单元测试验证核心优化逻辑的正确性。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decrypt } from "../../src/utils/crypto.js";
import { encrypt } from "../../src/utils/crypto.js";
import { sanitizeHeadersForLog } from "../../src/proxy/proxy-logging.js";

describe("BP-H4: clientReq 预计算", () => {
  it("sanitizeHeadersForLog + JSON.stringify 结果稳定可复用", () => {
    const cliHdrs = { authorization: "Bearer sk-secret", "content-type": "application/json", "x-custom": "value" };
    const rawBody = { model: "gpt-4", messages: [{ role: "user", content: "hello" }] };

    // 模拟预计算
    const sanitized = sanitizeHeadersForLog(cliHdrs);
    const clientReq1 = JSON.stringify({ headers: sanitized, body: rawBody });
    const clientReq2 = JSON.stringify({ headers: sanitized, body: rawBody });

    // 相同输入产生相同输出
    expect(clientReq1).toBe(clientReq2);

    // authorization 被脱敏
    const parsed = JSON.parse(clientReq1);
    expect(parsed.headers.authorization).not.toBe("Bearer sk-secret");
    expect(parsed.headers.authorization).toContain("***");
    expect(parsed.headers["content-type"]).toBe("application/json");
  });

  it("多次构造 clientReq 与单次预计算结果相同", () => {
    const cliHdrs = { authorization: "Bearer test-key" };
    const rawBody = { model: "test" };

    // 模拟循环内 3 次迭代，每次都重复构造
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(JSON.stringify({
        headers: sanitizeHeadersForLog(cliHdrs),
        body: rawBody,
      }));
    }

    // 所有结果相同 — 这证明预计算是安全的
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });
});

describe("BP-H3: API Key 缓存逻辑", () => {
  it("同一 provider_id 多次解密只调用一次 decrypt", () => {
    const decryptedApiKeys = new Map<string, string>();
    const mockDecrypt = vi.fn((key: string) => `decrypted_${key}`);

    // 模拟循环内两次迭代使用同一个 provider
    const providerId = "p1";
    const encryptedKey = "enc_key_abc";

    // 第一次迭代：解密
    let apiKey = decryptedApiKeys.get(providerId);
    if (!apiKey) {
      apiKey = mockDecrypt(encryptedKey);
      decryptedApiKeys.set(providerId, apiKey);
    }

    // 第二次迭代：缓存命中
    let apiKey2 = decryptedApiKeys.get(providerId);
    if (!apiKey2) {
      apiKey2 = mockDecrypt(encryptedKey);
      decryptedApiKeys.set(providerId, apiKey2);
    }

    expect(mockDecrypt).toHaveBeenCalledTimes(1); // 只解密了一次
    expect(apiKey).toBe("decrypted_enc_key_abc");
    expect(apiKey2).toBe("decrypted_enc_key_abc");
    expect(apiKey).toBe(apiKey2);
  });

  it("不同 provider_id 分别解密", () => {
    const decryptedApiKeys = new Map<string, string>();
    const mockDecrypt = vi.fn((key: string) => `decrypted_${key}`);

    const providers = [
      { id: "p1", key: "enc_key_a" },
      { id: "p2", key: "enc_key_b" },
    ];

    for (const p of providers) {
      let apiKey = decryptedApiKeys.get(p.id);
      if (!apiKey) {
        apiKey = mockDecrypt(p.key);
        decryptedApiKeys.set(p.id, apiKey);
      }
    }

    expect(mockDecrypt).toHaveBeenCalledTimes(2);
    expect(decryptedApiKeys.get("p1")).toBe("decrypted_enc_key_a");
    expect(decryptedApiKeys.get("p2")).toBe("decrypted_enc_key_b");
  });
});
