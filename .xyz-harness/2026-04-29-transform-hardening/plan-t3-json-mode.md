# Task 3: JSON Mode Handling (response_format)

**Files:**
- Modify: `src/proxy/transform/request-transform.ts`
- Modify: `tests/proxy/transform/request-transform.test.ts`

---

- [ ] **Step 1: Write JSON mode tests**

Append to `tests/proxy/transform/request-transform.test.ts` in the `openaiToAnthropicRequest` describe block:

```typescript
it("drops response_format json_object and warns", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = openaiToAnthropicRequest({
    model: "gpt-4", messages: [], response_format: { type: "json_object" },
  });
  expect(result.response_format).toBeUndefined();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("response_format"));
  warnSpy.mockRestore();
});

it("drops response_format json_schema and warns", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = openaiToAnthropicRequest({
    model: "gpt-4", messages: [],
    response_format: { type: "json_schema", json_schema: { name: "test", schema: {} } },
  });
  expect(result.response_format).toBeUndefined();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("response_format"));
  warnSpy.mockRestore();
});

it("does not warn when response_format is absent", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  openaiToAnthropicRequest({ model: "gpt-4", messages: [] });
  expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("response_format"));
  warnSpy.mockRestore();
});
```

Add `vi` import at top (after existing imports):
```typescript
import { vi } from "vitest";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/proxy/transform/request-transform.test.ts
```

Expected: FAIL — `response_format` still in OA_KNOWN_FIELDS? No — it's NOT in OA_KNOWN_FIELDS, so it would be logged as dropped by `logDroppedFields`. But the test expects `result.response_format` to be undefined, which it already is since the field is dropped. However, the test expects a specific warn message about response_format, which currently doesn't exist.

Expected: FAIL on warn spy not matching "response_format" string.

- [ ] **Step 3: Add response_format to OA_KNOWN_FIELDS + add explicit handling**

Modify `src/proxy/transform/request-transform.ts`:

1. Add `response_format` to `OA_KNOWN_FIELDS` (line 6):
```typescript
const OA_KNOWN_FIELDS = new Set([
  "model", "messages", "max_completion_tokens", "max_tokens",
  "stop", "temperature", "top_p", "stream", "tools", "tool_choice",
  "parallel_tool_calls", "reasoning", "user", "n", "stream_options",
  "response_format",
]);
```

2. In `openaiToAnthropicRequest`, add response_format handling after the `user` mapping (after line 79, before `logDroppedFields`):
```typescript
// response_format: Anthropic 不支持，丢弃并提示
if (body.response_format) {
  console.warn(`[request-transform] response_format is not supported by Anthropic API, dropping: ${JSON.stringify(body.response_format)}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/proxy/transform/request-transform.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Run lint**

```bash
npx eslint src/proxy/transform/request-transform.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/proxy/transform/request-transform.ts tests/proxy/transform/request-transform.test.ts
git commit -m "feat(transform): handle response_format in OA→Ant request (drop + warn)"
```
