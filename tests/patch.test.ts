import { describe, it, expect } from "vitest";
import { patchNonDeepSeekToolMessages } from "../src/proxy/patch/deepseek/patch-non-deepseek-tools.js";
import { patchOrphanToolResultsOA } from "../src/proxy/patch/deepseek/patch-orphan-tool-results.js";
import { applyProviderPatches } from "../src/proxy/patch/index.js";

// ---------- patchNonDeepSeekToolMessages（方案 7，OpenAI 格式）----------

describe("patchNonDeepSeekToolMessages", () => {
  it("将无 reasoning_content 的 assistant tool_calls 降级为 text", () => {
    const body = {
      messages: [
        { role: "user", content: "read a file" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"a.ts"}' } }] },
        { role: "tool", tool_call_id: "call_1", content: "file content" },
        { role: "user", content: "thanks" },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    const assistant = body.messages[1] as Record<string, unknown>;
    expect(assistant.tool_calls).toBeUndefined();
    expect(typeof assistant.content).toBe("string");
    expect((assistant.content as string)).toContain("[tool_calls]:");
    expect((assistant.content as string)).toContain("call_1");

    const tool = body.messages[2] as Record<string, unknown>;
    expect(tool.role).toBe("user");
    expect(tool.tool_call_id).toBeUndefined();
    expect(typeof tool.content).toBe("string");
    expect((tool.content as string)).toContain("tool_result");
  });

  it("保留有 reasoning_content 的 DeepSeek 原生消息", () => {
    const body = {
      messages: [
        { role: "assistant", reasoning_content: "thinking...", content: null, tool_calls: [{ id: "call_ds", type: "function", function: { name: "read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_ds", content: "result" },
      ],
    };
    const original = JSON.stringify(body);
    patchNonDeepSeekToolMessages(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("无 tool_calls 时不修改", () => {
    const body = {
      messages: [
        { role: "assistant", content: "hello" },
      ],
    };
    const original = JSON.stringify(body);
    patchNonDeepSeekToolMessages(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("保留 assistant 的原始 content", () => {
    const body = {
      messages: [
        { role: "assistant", content: "Let me read that file.", tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "file" },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    const assistant = body.messages[0] as Record<string, unknown>;
    expect((assistant.content as string)).toContain("Let me read that file.");
    expect((assistant.content as string)).toContain("[tool_calls]:");
  });

  it("无 messages 时安全返回", () => {
    expect(() => patchNonDeepSeekToolMessages({})).not.toThrow();
    expect(() => patchNonDeepSeekToolMessages({ messages: [] })).not.toThrow();
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
    // orphan tool removed, then consecutive users merged
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

  it("合并连续 user 消息（移除 orphan 后）", () => {
    const body = {
      messages: [
        { role: "user", content: "first" },
        { role: "tool", tool_call_id: "call_ghost", content: "orphan" },
        { role: "user", content: "second" },
      ],
    };
    patchOrphanToolResultsOA(body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect((body.messages[0].content as string)).toContain("first");
    expect((body.messages[0].content as string)).toContain("second");
  });

  it("无孤儿时不修改", () => {
    const body = {
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "A", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
    };
    const original = JSON.stringify(body);
    patchOrphanToolResultsOA(body);
    expect(JSON.stringify(body)).toBe(original);
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
