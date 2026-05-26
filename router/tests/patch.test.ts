import { describe, it, expect } from "vitest";
import { patchThinkingConsistency, _internals } from "../src/proxy/patch/deepseek/patch-thinking.js";
import { patchOrphanToolResultsOA, patchOrphanToolResults } from "../src/proxy/patch/deepseek/patch-orphan-tool-results.js";
import { applyProviderPatches } from "../src/proxy/patch/index.js";

// ---------- patchMissingReasoningContent ----------

describe("patchMissingReasoningContent", () => {
  it("thinking 未激活时不补 reasoning_content", () => {
    const body = {
      messages: [
        { role: "user", content: "read a file" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"a.ts"}' } }] },
        { role: "tool", tool_call_id: "call_1", content: "file content" },
      ],
    };
    const original = JSON.stringify(body);
    _internals.patchMissingReasoningContent(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("thinking 激活时对有 tool_calls 但无 reasoning_content 的消息补空字符串", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: "read a file" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"a.ts"}' } }] },
        { role: "tool", tool_call_id: "call_1", content: "file content" },
      ],
    };
    _internals.patchMissingReasoningContent(body);

    const assistant = body.messages[1] as Record<string, unknown>;
    expect(assistant.reasoning_content).toBe("");
    expect(assistant.tool_calls).toHaveLength(1);
    expect((assistant.tool_calls as Array<Record<string, unknown>>)[0].id).toBe("call_1");
  });

  it("已有 reasoning_content 的消息不修改", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", reasoning_content: "thinking...", content: null, tool_calls: [{ id: "call_ds", type: "function", function: { name: "read", arguments: "{}" } }] },
      ],
    };
    const original = JSON.stringify(body);
    _internals.patchMissingReasoningContent(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("无 tool_calls 的消息不修改", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: "hello" },
      ],
    };
    const original = JSON.stringify(body);
    _internals.patchMissingReasoningContent(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("无 messages 时安全返回", () => {
    expect(() => _internals.patchMissingReasoningContent({})).not.toThrow();
    expect(() => _internals.patchMissingReasoningContent({ thinking: { type: "enabled" }, messages: [] })).not.toThrow();
  });
});

// ---------- patchThinkingConsistency 集成 ----------

describe("patchThinkingConsistency", () => {
  it("OpenAI 路径：注入 thinking + 补 reasoning_content", () => {
    const body = {
      messages: [
        { role: "assistant", reasoning_content: "I thought...", content: "hello" },
        { role: "user", content: "now read a file" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
      ],
    };
    patchThinkingConsistency(body, "openai");

    expect(body.thinking).toEqual({ type: "enabled" });
    const lastAssistant = body.messages[2] as Record<string, unknown>;
    expect(lastAssistant.reasoning_content).toBe("");
  });

  it("Anthropic 路径：注入 thinking + 补 thinking block + 剥离 cache_control", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I thought...", signature: "abc" },
            { type: "text", text: "hello" },
          ],
        },
        { role: "user", content: [{ type: "text", text: "go" }, { type: "tool_result", tool_use_id: "t1", content: "ok", cache_control: { type: "ephemeral" } }] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "read", input: {} },
          ],
        },
      ],
      tools: [{ name: "read", description: "read", input_schema: {}, cache_control: { type: "ephemeral" } }],
    };
    patchThinkingConsistency(body, "anthropic");

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });

    const lastAssistant = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(lastAssistant.content[0].type).toBe("thinking");

    const userMsg = body.messages[1] as { content: Array<Record<string, unknown>> };
    expect(userMsg.content[1].cache_control).toBeUndefined();
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0].cache_control).toBeUndefined();
  });
});

// ---------- patchOrphanToolResults（OpenAI 格式）----------

describe("patchOrphanToolResultsOA", () => {
  it("移除没有对应 tool_calls 的 tool 消息", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", tool_call_id: "call_ghost", content: "orphan result" },
        { role: "user", content: "next" },
      ],
    };
    patchOrphanToolResultsOA(body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect((body.messages[0].content as string)).toContain("hi");
    expect((body.messages[0].content as string)).toContain("next");
  });

  it("保留有匹配 tool_calls 的 tool 消息", () => {
    const body = {
      messages: [
        { role: "assistant", content: null, tool_calls: [
          { id: "call_a", type: "function", function: { name: "A", arguments: "{}" } },
          { id: "call_b", type: "function", function: { name: "B", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "call_a", content: "result a" },
        { role: "tool", tool_call_id: "call_b", content: "result b" },
      ],
    };
    patchOrphanToolResultsOA(body);
    expect(body.messages).toHaveLength(3);
  });

  it("混合场景：保留配对的，移除孤儿的", () => {
    const body = {
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "A", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
        { role: "assistant", content: "I processed it." },
        { role: "tool", tool_call_id: "call_ghost", content: "orphan" },
        { role: "user", content: "next" },
      ],
    };
    patchOrphanToolResultsOA(body);
    const roles = (body.messages as Array<{ role: string }>).map(m => m.role);
    expect(roles).toEqual(["assistant", "tool", "assistant", "user"]);
  });

  // ---- 反向：移除孤儿 tool_calls ----

  it("反向：移除非末尾 assistant 中无对应 tool 消息的 tool_call 条目", () => {
    const body = {
      messages: [
        { role: "user", content: "read a file" },
        { role: "assistant", content: null, tool_calls: [{ id: "orphan_1", type: "function", function: { name: "read", arguments: "{}" } }] },
        { role: "user", content: "你找到了什么?" },
      ],
    };
    patchOrphanToolResultsOA(body);
    const orphanAssistant = body.messages[1] as Record<string, unknown>;
    expect(orphanAssistant.tool_calls).toBeUndefined();
    expect(body.messages).toHaveLength(3);
  });

  it("反向：末尾 assistant 的 tool_calls 保持不动（正常的工具调用中间状态）", () => {
    const body = {
      messages: [
        { role: "user", content: "read a file" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
      ],
    };
    patchOrphanToolResultsOA(body);
    const lastAssistant = body.messages[1] as Record<string, unknown>;
    expect(lastAssistant.tool_calls).toHaveLength(1);
  });

  it("反向：部分配对时只移除未配对的 tool_call，保留已配对的", () => {
    const body = {
      messages: [
        { role: "assistant", content: null, tool_calls: [
          { id: "matched", type: "function", function: { name: "A", arguments: "{}" } },
          { id: "orphan", type: "function", function: { name: "B", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "matched", content: "ok" },
        { role: "assistant", content: "done" },
      ],
    };
    patchOrphanToolResultsOA(body);
    const firstAssistant = body.messages[0] as Record<string, unknown>;
    const calls = firstAssistant.tool_calls as Array<Record<string, unknown>>;
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe("matched");
  });

  it("反向：Claude Code 截断场景的完整消息链修复", () => {
    const body = {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "read file.ts" },
        { role: "assistant", content: null, tool_calls: [{ id: "toolu_1", type: "function", function: { name: "read", arguments: "{\"path\":\"file.ts\"}" } }] },
        { role: "user", content: "你找到了什么?" },
        { role: "assistant", content: null, tool_calls: [{ id: "toolu_2", type: "function", function: { name: "read", arguments: "{\"path\":\"other.ts\"}" } }] },
        { role: "tool", tool_call_id: "toolu_2", content: "other file content" },
        { role: "assistant", content: "这是 other.ts 的内容" },
        { role: "user", content: "继续" },
      ],
    };
    patchOrphanToolResultsOA(body);
    // toolu_1 是孤儿（无对应 tool 消息），应被移除
    const firstAssistant = body.messages[2] as Record<string, unknown>;
    expect(firstAssistant.tool_calls).toBeUndefined();
    // toolu_2 有配对，保持不动（index 4 是 toolu_2 的 assistant）
    const secondAssistant = body.messages[4] as Record<string, unknown>;
    expect((secondAssistant.tool_calls as unknown[]).length).toBe(1);
    // 末尾是 user "继续"，倒数第二个是 assistant
    const lastUser = body.messages[body.messages.length - 1] as Record<string, unknown>;
    expect(lastUser.content).toBe("继续");
    const prevAssistant = body.messages[body.messages.length - 2] as Record<string, unknown>;
    expect(prevAssistant.content).toBe("这是 other.ts 的内容");
  });

  it("空 messages 时安全返回", () => {
    expect(() => patchOrphanToolResultsOA({})).not.toThrow();
    expect(() => patchOrphanToolResultsOA({ messages: [] })).not.toThrow();
  });
});

// ---------- patchOrphanToolResults（Anthropic 格式）----------

describe("patchOrphanToolResults", () => {
  it("正向：移除无主 tool_result 块", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost_id", content: "orphan" }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ],
    };
    patchOrphanToolResults(body);
    expect(body.messages).toHaveLength(2);
  });

  it("反向：移除非末尾 assistant 中无对应 tool_result 的 tool_use 块", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "read a file" }] },
        { role: "assistant", content: [
          { type: "tool_use", id: "orphan_use", name: "read", input: { path: "a.ts" } },
        ] },
        { role: "user", content: [{ type: "text", text: "你找到了什么?" }] },
      ],
    };
    patchOrphanToolResults(body);
    // tool_use 被移除后 assistant content 为空，空 assistant 被清理
    // 两个 user 消息合并（Anthropic 不允许连续 user）
    const roles = (body.messages as Array<{ role: string }>).map(m => m.role);
    expect(roles).toEqual(["user"]);
    // 合并后的 user content 包含两段文本
    const userMsg = body.messages[0] as { content: Array<{ type: string; text?: string }> };
    const texts = userMsg.content.filter(b => b.type === "text").map(b => b.text);
    expect(texts).toContain("read a file");
    expect(texts).toContain("你找到了什么?");
  });

  it("反向：末尾 assistant 的 tool_use 保持不动", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "read a file" }] },
        { role: "assistant", content: [
          { type: "tool_use", id: "toolu_1", name: "read", input: {} },
        ] },
      ],
    };
    patchOrphanToolResults(body);
    const lastMsg = body.messages[1] as { content: Array<{ type: string }> };
    expect(lastMsg.content.some(b => b.type === "tool_use")).toBe(true);
  });

  it("反向：部分配对时只移除未配对的 tool_use", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "assistant", content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", id: "matched_id", name: "A", input: {} },
          { type: "tool_use", id: "orphan_id", name: "B", input: {} },
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "matched_id", content: "ok" }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ],
    };
    patchOrphanToolResults(body);
    const assistant = body.messages[1] as { content: Array<{ type: string; id?: string }> };
    const toolUses = assistant.content.filter(b => b.type === "tool_use");
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0].id).toBe("matched_id");
    expect(assistant.content.some(b => b.type === "text")).toBe(true);
  });

  it("正常配对的消息链不做任何修改", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ],
    };
    const original = JSON.stringify(body);
    patchOrphanToolResults(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("空 messages 时安全返回", () => {
    expect(() => patchOrphanToolResults({})).not.toThrow();
    expect(() => patchOrphanToolResults({ messages: [] })).not.toThrow();
  });
});

// ---------- applyProviderPatches 集成 ----------

describe("applyProviderPatches", () => {
  it("DeepSeek provider + orphan tool → 清理", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", tool_call_id: "call_ghost", content: "orphan" },
        { role: "user", content: "next" },
      ],
    };
    const { body: result, meta } = applyProviderPatches(body, {
      base_url: "https://api.deepseek.com",
      api_type: "openai",
    });
    expect(meta.types).toContain("deepseek");
    expect((result.messages as unknown[]).every((m: unknown) => (m as { role: string }).role !== "tool")).toBe(true);
  });

  it("非 DeepSeek 非 OpenAI 官方 provider → developer_role patch", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    };
    const { body: result, meta } = applyProviderPatches(body, {
      base_url: "http://localhost:11434",
      api_type: "openai",
    });
    expect(meta.types).toContain("developer_role");
    expect((result.messages as Array<{ role: string }>)[0].role).toBe("system");
  });

  it("非 DeepSeek provider 时不触发 deepseek patch", () => {
    const body = {
      messages: [
        { role: "assistant", content: "hi" },
      ],
    };
    const { meta } = applyProviderPatches(body, {
      base_url: "https://open.bigmodel.cn/api",
      api_type: "openai",
    });
    expect(meta.types).not.toContain("deepseek");
  });

  it("developer_role + deepseek 组合", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are helpful." },
        { role: "user", content: "hi" },
        { role: "tool", tool_call_id: "call_ghost", content: "orphan" },
      ],
    };
    const { body: result, meta } = applyProviderPatches(body, {
      base_url: "https://api.deepseek.com",
      api_type: "openai",
    });
    expect(meta.types).toContain("developer_role");
    expect(meta.types).toContain("deepseek");
    expect((result.messages as Array<{ role: string }>)[0].role).toBe("system");
    expect((result.messages as unknown[]).every((m: unknown) => (m as { role: string }).role !== "tool")).toBe(true);
  });
});
