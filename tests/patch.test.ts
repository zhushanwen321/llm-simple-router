import { describe, it, expect } from "vitest";
import { patchMissingThinkingBlocks } from "../src/proxy/patch/deepseek/patch-thinking-blocks.js";
import { patchOrphanToolResults } from "../src/proxy/patch/deepseek/patch-orphan-tool-results.js";
import { patchToolsFormat } from "../src/proxy/patch/deepseek/patch-tools-format.js";
import { applyProviderPatches } from "../src/proxy/patch/index.js";

describe("patchMissingThinkingBlocks", () => {
  it("为缺少 thinking 的 assistant 消息添加空 thinking block", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h", signature: "s" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const lastAssistant = body.messages[2] as { content: unknown[] };
    expect(lastAssistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "" });
    expect(lastAssistant.content[1]).toEqual({ type: "text", text: "hi" });
  });

  it("thinking 未激活时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[1] as { content: unknown[] };
    expect(assistant.content).toHaveLength(1);
  });

  it("body.thinking 为 true 时视为激活", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 10000 },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[0] as { content: unknown[] };
    expect(assistant.content).toHaveLength(2);
    expect((assistant.content[0] as { type: string }).type).toBe("thinking");
  });

  it("无 messages 时安全返回", () => {
    const body = {};
    expect(() => patchMissingThinkingBlocks(body)).not.toThrow();
  });
});

describe("patchOrphanToolResults", () => {
  it("移除没有对应 tool_use 的 tool_result 块", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "Read", input: {} }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: "ok" },
          { type: "tool_result", tool_use_id: "call_orphan", content: "orphan" },
        ] },
      ],
    };
    patchOrphanToolResults(body);
    const userMsg = body.messages[1] as { content: unknown[] };
    expect(userMsg.content).toHaveLength(1);
    expect((userMsg.content[0] as { tool_use_id: string }).tool_use_id).toBe("call_1");
  });

  it("保留有匹配 tool_use 的 tool_result", () => {
    const body = {
      messages: [
        { role: "assistant", content: [
          { type: "tool_use", id: "call_a", name: "A", input: {} },
          { type: "tool_use", id: "call_b", name: "B", input: {} },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_a", content: "a" },
          { type: "tool_result", tool_use_id: "call_b", content: "b" },
        ] },
      ],
    };
    patchOrphanToolResults(body);
    const userMsg = body.messages[1] as { content: unknown[] };
    expect(userMsg.content).toHaveLength(2);
  });

  it("移除清空后的空 user 消息并合并相邻 user", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: "ok" },
          { type: "tool_result", tool_use_id: "call_orphan", content: "x" },
        ] },
        { role: "user", content: [{ type: "text", text: "follow-up" }] },
      ],
    };
    patchOrphanToolResults(body);
    // call_orphan 被移除，msg[1] 非空但和 msg[2] 连续 → 合并为一条 user
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages[1].role).toBe("user");
    const merged = body.messages[1].content as unknown[];
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ type: "tool_result", tool_use_id: "call_1", content: "ok" });
    expect(merged[1]).toEqual({ type: "text", text: "follow-up" });
  });

  it("无 tool_use 时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    patchOrphanToolResults(body);
    expect(body.messages).toHaveLength(3);
  });

  it("无孤儿时不修改", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
      ],
    };
    patchOrphanToolResults(body);
    expect(body.messages).toHaveLength(2);
  });

  it("空 messages 时安全返回", () => {
    const body = { messages: [] };
    expect(() => patchOrphanToolResults(body)).not.toThrow();
  });

  it("删除空 user 后合并连续 assistant 消息", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "orphan_1", content: "x" }] },
        { role: "assistant", content: [{ type: "text", text: "response" }] },
        { role: "user", content: "next" },
      ],
    };
    patchOrphanToolResults(body);
    // orphan_1 被移除 → 空 user 被删除 → 两个 assistant 合并
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages[1].role).toBe("user");
    const merged = body.messages[0].content as unknown[];
    expect(merged).toHaveLength(2);
    expect((merged[0] as Record<string, unknown>).type).toBe("tool_use");
    expect((merged[1] as Record<string, unknown>).type).toBe("text");
  });

  it("大规模孤儿场景（模拟 70+ 孤儿）", () => {
    const messages: unknown[] = [
      { role: "user", content: "start" },
    ];
    // 30 个正常配对的 tool_use/tool_result
    for (let i = 0; i < 30; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `call_valid_${i}`, name: "Read", input: {} }],
      });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `call_valid_${i}`, content: "ok" }],
      });
    }
    // 70 个孤儿 tool_result（在连续 user 消息中）
    for (let i = 0; i < 70; i++) {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `call_orphan_${i}`, content: "x" }],
      });
    }
    // 最后一条正常消息
    messages.push({ role: "user", content: [{ type: "text", text: "final" }] });

    const body = { messages };
    patchOrphanToolResults(body);

    // 70 个孤儿消息应被删除，只保留正常配对 + start + final
    // final 会与最后一个正常的 tool_result user 合并（如果相邻）
    const result = body.messages as unknown[];
    // 验证没有孤儿残留
    const allToolUseIds = new Set<string>();
    for (const msg of result) {
      const m = msg as { role: string; content: unknown[] };
      if (m.role === "assistant" && Array.isArray(m.content)) {
        for (const b of m.content) {
          if ((b as { type: string }).type === "tool_use") allToolUseIds.add((b as { id: string }).id);
        }
      }
    }
    for (const msg of result) {
      const m = msg as { role: string; content: unknown[] };
      if (m.role === "user" && Array.isArray(m.content)) {
        for (const b of m.content) {
          if ((b as { type: string }).type === "tool_result") {
            expect(allToolUseIds.has((b as { tool_use_id: string }).tool_use_id)).toBe(true);
          }
        }
      }
    }
  });
});

describe("patchToolsFormat", () => {
  it("将 Anthropic 格式 tools 转换为 OpenAI 格式", () => {
    const body = {
      tools: [
        { name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
        { name: "write_file", description: "Write a file", input_schema: { type: "object" } },
      ],
    };
    patchToolsFormat(body);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } },
      { type: "function", function: { name: "write_file", description: "Write a file", parameters: { type: "object" } } },
    ]);
  });

  it("跳过已是 OpenAI 格式的 tools", () => {
    const body = {
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
    };
    patchToolsFormat(body);
    expect(body.tools).toEqual([{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }]);
  });

  it("处理缺少可选字段的 tool", () => {
    const body = { tools: [{ name: "minimal_tool" }] };
    patchToolsFormat(body);
    expect(body.tools).toEqual([{ type: "function", function: { name: "minimal_tool" } }]);
  });

  it("无 tools 时不修改", () => {
    const body = { messages: [] };
    patchToolsFormat(body);
    expect(body).toEqual({ messages: [] });
  });

  it("空 tools 数组时不修改", () => {
    const body = { tools: [] };
    patchToolsFormat(body);
    expect(body.tools).toEqual([]);
  });

  it("混合格式时只转换 Anthropic 格式的", () => {
    const body = {
      tools: [
        { name: "anthropic_tool", description: "A", input_schema: { type: "object" } },
        { type: "function", function: { name: "openai_tool", parameters: { type: "object" } } },
        { name: "another_anthropic" },
      ],
    };
    patchToolsFormat(body);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "anthropic_tool", description: "A", parameters: { type: "object" } } },
      { type: "function", function: { name: "openai_tool", parameters: { type: "object" } } },
      { type: "function", function: { name: "another_anthropic" } },
    ]);
  });
});

describe("applyProviderPatches", () => {
  it("DeepSeek provider 时触发补丁", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    applyProviderPatches(body, { base_url: "https://api.deepseek.com/anthropic" });
    // thinking patch 应该已添加 thinking block
    const assistant = body.messages[0] as { content: unknown[] };
    expect((assistant.content[0] as { type: string }).type).toBe("thinking");
  });

  it("非 DeepSeek provider 时不修改", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const original = JSON.stringify(body);
    applyProviderPatches(body, { base_url: "https://open.bigmodel.cn/api/anthropic" });
    expect(JSON.stringify(body)).toBe(original);
  });

  it("deepseek 模型通过非 deepseek provider 时也触发 tools 转换", () => {
    const body = {
      model: "deepseek-v4-flash",
      tools: [{ name: "read_file", description: "Read", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
    };
    applyProviderPatches(body, { base_url: "https://opencode.ai/zen/go" });
    expect((body.tools as unknown[])[0]).toEqual({
      type: "function",
      function: { name: "read_file", description: "Read", parameters: { type: "object" } },
    });
  });
});
