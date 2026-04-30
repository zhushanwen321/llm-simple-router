# Task 2: Error Response Classification (error-classifier.ts)

**Files:**
- Create: `src/proxy/transform/error-classifier.ts`
- Create: `tests/proxy/transform/error-classifier.test.ts`
- Modify: `src/proxy/transform/response-transform.ts`
- Modify: `tests/proxy/transform/response-transform.test.ts`

---

- [ ] **Step 1: Write classifier tests**

Create `tests/proxy/transform/error-classifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyError } from "../../../src/proxy/transform/error-classifier.js";

describe("classifyError", () => {
  it("classifies Anthropic 401 authentication_error", () => {
    const r = classifyError(401, JSON.stringify({ type: "error", error: { type: "authentication_error" } }));
    expect(r.category).toBe("authentication");
    expect(r.retryable).toBe(false);
  });

  it("classifies OpenAI 400 context_length_exceeded", () => {
    const r = classifyError(400, JSON.stringify({ error: { code: "context_length_exceeded" } }));
    expect(r.category).toBe("context_too_long");
  });

  it("classifies Anthropic 529 overloaded_error", () => {
    const r = classifyError(529, JSON.stringify({ type: "error", error: { type: "overloaded_error" } }));
    expect(r.category).toBe("overloaded");
    expect(r.retryable).toBe(true);
  });

  it("classifies OpenAI 429 insufficient_quota as quota_exceeded (not retryable)", () => {
    const r = classifyError(429, JSON.stringify({ error: { type: "insufficient_quota" } }));
    expect(r.category).toBe("quota_exceeded");
    expect(r.retryable).toBe(false);
  });

  it("classifies OpenAI 429 rate_limit_error as rate_limit (retryable)", () => {
    const r = classifyError(429, JSON.stringify({ error: { type: "rate_limit_error" } }));
    expect(r.category).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });

  it("classifies Anthropic 429 rate_limit_error (retryable)", () => {
    const r = classifyError(429, JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }));
    expect(r.category).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });

  it("classifies 403 permission_error", () => {
    const r = classifyError(403, JSON.stringify({ error: { type: "permission_error" } }));
    expect(r.category).toBe("permission");
    expect(r.retryable).toBe(false);
  });

  it("classifies 500 as server_error (retryable)", () => {
    const r = classifyError(500, "{}");
    expect(r.category).toBe("server_error");
    expect(r.retryable).toBe(true);
  });

  it("classifies 502 as server_error (retryable)", () => {
    const r = classifyError(502, "{}");
    expect(r.category).toBe("server_error");
    expect(r.retryable).toBe(true);
  });

  it("classifies unknown status 418 as unknown", () => {
    const r = classifyError(418, "I'm a teapot");
    expect(r.category).toBe("unknown");
    expect(r.retryable).toBe(false);
  });

  it("classifies 400 with content_filter", () => {
    const r = classifyError(400, JSON.stringify({ error: { code: "content_filter" } }));
    expect(r.category).toBe("content_filter");
    expect(r.retryable).toBe(false);
  });

  it("classifies 400 generic as validation", () => {
    const r = classifyError(400, JSON.stringify({ error: { type: "invalid_request_error" } }));
    expect(r.category).toBe("validation");
    expect(r.retryable).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/proxy/transform/error-classifier.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write classifier implementation**

Create `src/proxy/transform/error-classifier.ts`:

```typescript
export type ErrorCategory =
  | "authentication" | "permission" | "not_found" | "validation"
  | "context_too_long" | "content_filter" | "rate_limit" | "quota_exceeded"
  | "overloaded" | "timeout" | "server_error" | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  statusCode: number;
  originalType?: string;
  originalCode?: string;
}

export function classifyError(statusCode: number, errorBody: string): ClassifiedError {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(errorBody); } catch { /* non-JSON body, use status code only */ }

  // Anthropic wraps in { type: "error", error: { ... } }
  const errObj = (parsed.error as Record<string, unknown>) ?? parsed;
  const type = String(errObj.type ?? parsed.type ?? "");
  const code = String(errObj.code ?? "");

  // 429: rate_limit vs quota_exceeded
  if (statusCode === 429) {
    if (type === "insufficient_quota" || code === "insufficient_quota") {
      return { category: "quota_exceeded", retryable: false, statusCode, originalType: type, originalCode: code };
    }
    return { category: "rate_limit", retryable: true, statusCode, originalType: type, originalCode: code };
  }

  // 529: Anthropic overloaded
  if (statusCode === 529) {
    return { category: "overloaded", retryable: true, statusCode, originalType: type, originalCode: code };
  }

  // Structured type/code matching
  if (type === "authentication_error") return { category: "authentication", retryable: false, statusCode, originalType: type };
  if (type === "permission_error") return { category: "permission", retryable: false, statusCode, originalType: type };
  if (type === "not_found_error") return { category: "not_found", retryable: false, statusCode, originalType: type };
  if (type === "timeout_error") return { category: "timeout", retryable: true, statusCode, originalType: type };

  // 400 sub-classification
  if (statusCode === 400) {
    if (code === "context_length_exceeded" || type === "context_length_exceeded") {
      return { category: "context_too_long", retryable: false, statusCode, originalType: type, originalCode: code };
    }
    if (type.includes("content_filter") || code.includes("content_filter") ||
        type.includes("policy") || code.includes("policy")) {
      return { category: "content_filter", retryable: false, statusCode, originalType: type, originalCode: code };
    }
    return { category: "validation", retryable: false, statusCode, originalType: type, originalCode: code };
  }

  // HTTP status code fallback
  if (statusCode === 401) return { category: "authentication", retryable: false, statusCode };
  if (statusCode === 403) return { category: "permission", retryable: false, statusCode };
  if (statusCode === 404) return { category: "not_found", retryable: false, statusCode };
  if (statusCode === 408 || statusCode === 504) return { category: "timeout", retryable: true, statusCode };
  if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
    return { category: "server_error", retryable: true, statusCode };
  }

  return { category: "unknown", retryable: false, statusCode };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/proxy/transform/error-classifier.test.ts
```

Expected: PASS (12 tests)

- [ ] **Step 5: Add regression test (classifyError is standalone, transformErrorResponse unchanged)**

`classifyError` 作为独立工具导出，`transformErrorResponse` 不修改（因为该函数不接收 HTTP 状态码，且没有 request 上下文）。分类由 proxy-handler 层调用。

在 `tests/proxy/transform/response-transform.test.ts` 末尾添加导入和测试：

```typescript
import { classifyError } from "../../../src/proxy/transform/error-classifier.js";

describe("classifyError integration with error transform", () => {
  it("classifies transformed Anthropic error", () => {
    const antError = JSON.stringify({ type: "error", error: { type: "authentication_error", message: "Bad key" } });
    const classified = classifyError(401, antError);
    expect(classified.category).toBe("authentication");
    expect(classified.retryable).toBe(false);
    // Error format unchanged
    const transformed = JSON.parse(transformErrorResponse(antError, "anthropic", "openai"));
    expect(transformed.error.message).toBe("Bad key");
  });
});
```

- [ ] **Step 6: Run all affected tests**

```bash
npx vitest run tests/proxy/transform/error-classifier.test.ts tests/proxy/transform/response-transform.test.ts
```

Expected: ALL PASS

- [ ] **Step 7: Run lint**

```bash
npx eslint src/proxy/transform/error-classifier.ts
```

Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/proxy/transform/error-classifier.ts tests/proxy/transform/error-classifier.test.ts tests/proxy/transform/response-transform.test.ts
git commit -m "feat(transform): add error response semantic classifier"
```
