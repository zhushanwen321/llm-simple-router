import { describe, it, expect } from "vitest";
import { patchThinkingConsistency, _internals } from "../src/proxy/patch/deepseek/patch-thinking.js";
import { patchOrphanToolResultsOA } from "../src/proxy/patch/deepseek/patch-orphan-tool-results.js";
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

describe("patchOrphanToolResults", () => {
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

  it("空 messages 时安全返回", () => {
    expect(() => patchOrphanToolResultsOA({})).not.toThrow();
    expect(() => patchOrphanToolResultsOA({ messages: [] })).not.toThrow();
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
