# Task 1: Message Self-Healing (sanitize.ts)

**Files:**
- Create: `src/proxy/transform/sanitize.ts`
- Create: `tests/proxy/transform/sanitize.test.ts`
- Modify: `src/proxy/transform/message-mapper.ts`
- Modify: `tests/proxy/transform/message-mapper.test.ts`

---

- [ ] **Step 1: Write sanitize tests**

Create `tests/proxy/transform/sanitize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeToolUseId, ensureNonEmptyContent } from "../../../src/proxy/transform/sanitize.js";

describe("sanitizeToolUseId", () => {
  it("returns valid id unchanged", () => {
    expect(sanitizeToolUseId("toolu_abc123")).toBe("toolu_abc123");
  });
  it("replaces dots with underscore", () => {
    expect(sanitizeToolUseId("call.123")).toBe("call_123");
  });
  it("replaces @#$ with underscores", () => {
    expect(sanitizeToolUseId("id@#$$")).toBe("id____");
  });
  it("returns fallback for empty string", () => {
    expect(sanitizeToolUseId("")).toBe("toolu_unknown");
  });
});

describe("ensureNonEmptyContent", () => {
  it("replaces empty string content with space", () => {
    const msgs = [{ role: "user", content: "" }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe(" ");
  });
  it("replaces null content with space", () => {
    const msgs = [{ role: "user", content: null }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe(" ");
  });
  it("replaces empty array content with space", () => {
    const msgs = [{ role: "user", content: [] }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe(" ");
  });
  it("does not modify non-empty string content", () => {
    const msgs = [{ role: "user", content: "hello" }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe("hello");
  });
  it("does not modify non-empty array content", () => {
    const msgs = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toEqual([{ type: "text", text: "hi" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/proxy/transform/sanitize.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write sanitize implementation**

Create `src/proxy/transform/sanitize.ts`:

```typescript
export function sanitizeToolUseId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "toolu_unknown";
}

export function ensureNonEmptyContent(messages: unknown[]): void {
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (!m.content || m.content === "" ||
        (Array.isArray(m.content) && m.content.length === 0)) {
      m.content = " ";
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/proxy/transform/sanitize.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Integrate into message-mapper.ts**

Modify `src/proxy/transform/message-mapper.ts`:

1. Add import at top (after existing imports):
```typescript
import { sanitizeToolUseId, ensureNonEmptyContent } from "./sanitize.js";
```

2. In `convertMessagesOA2Ant`, add `ensureNonEmptyContent(messages)` before `extractSystemMessages` call (before line 43):
```typescript
export function convertMessagesOA2Ant(messages: unknown[]): {
  system?: string;
  messages: AntMessage[];
} {
  ensureNonEmptyContent(messages);
  const { systemParts, nonSystemMsgs } = extractSystemMessages(messages);
```

3. In assistant tool_calls processing (line 65), wrap id:
```typescript
blocks.push({ type: "tool_use", id: sanitizeToolUseId(String(tc.id)), name: String(fn.name), input });
```

4. In tool role processing (line 74), wrap tool_use_id:
```typescript
tool_use_id: sanitizeToolUseId(String(m.tool_call_id ?? "")),
```

- [ ] **Step 6: Add sanitize integration tests to message-mapper.test.ts**

Append to `tests/proxy/transform/message-mapper.test.ts` inside the `convertMessagesOA2Ant` describe block:

```typescript
it("sanitizes tool_use_id with special characters", () => {
  const msgs = [
    { role: "assistant", content: null, tool_calls: [{ id: "call.123", type: "function", function: { name: "fn", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call.456@val", content: "ok" },
  ];
  const { messages } = convertMessagesOA2Ant(msgs);
  const assistantContent = (messages[1] as Record<string, unknown>).content as Array<Record<string, unknown>>;
  expect(assistantContent[0].id).toBe("call_123");
  const userContent = (messages[2] as Record<string, unknown>).content as Array<Record<string, unknown>>;
  expect((userContent[0] as Record<string, unknown>).tool_use_id).toBe("call_456_val");
});

it("fills empty content with space placeholder", () => {
  const msgs = [{ role: "user", content: "" }, { role: "assistant", content: "hi" }];
  const { messages } = convertMessagesOA2Ant(msgs);
  const userContent = (messages[0] as Record<string, unknown>).content;
  expect(userContent).toEqual([{ type: "text", text: " " }]);
});
```

- [ ] **Step 7: Run all affected tests**

```bash
npx vitest run tests/proxy/transform/message-mapper.test.ts tests/proxy/transform/sanitize.test.ts
```

Expected: ALL PASS

- [ ] **Step 8: Run lint**

```bash
npx eslint src/proxy/transform/sanitize.ts src/proxy/transform/message-mapper.ts
```

Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/proxy/transform/sanitize.ts tests/proxy/transform/sanitize.test.ts src/proxy/transform/message-mapper.ts tests/proxy/transform/message-mapper.test.ts
git commit -m "feat(transform): add message self-healing (sanitize tool IDs + empty content)"
```
