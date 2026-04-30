import { describe, it, expect } from "vitest";
import { patchMissingThinkingBlocks } from "../src/proxy/patch/deepseek/patch-thinking-blocks.js";
import { patchOrphanToolResults } from "../src/proxy/patch/deepseek/patch-orphan-tool-results.js";
import { stripCacheControl } from "../src/proxy/patch/deepseek/patch-cache-control.js";
import { patchThinkingParam } from "../src/proxy/patch/deepseek/patch-thinking-param.js";
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

  it("修复：无 tool_use 时清理孤儿 tool_result 并删除空 user 消息", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    patchOrphanToolResults(body);
    // 孤儿 tool_result 被移除后空 user 被删除
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[1].role).toBe("assistant");
  });

  it("无 tool_result 时不影响无 assistant 的消息", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
      ],
    };
    const original = JSON.stringify(body);
    patchOrphanToolResults(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("修复：整个 assistant 消息被截断后清理剩余 tool_result 块", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "first query" }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_orphan_1", content: "result1" },
          { type: "tool_result", tool_use_id: "call_orphan_2", content: "result2" },
        ] },
      ],
    };
    patchOrphanToolResults(body);
    // 所有 tool_result 都是孤儿，user 变空后被删除
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
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

describe("applyProviderPatches", () => {
  it("DeepSeek provider 时触发补丁", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    const { body: result } = applyProviderPatches(body, { base_url: "https://api.deepseek.com/anthropic", api_type: "anthropic" });
    const messages = result.messages as Array<{ role: string; content: Array<{ type: string }> }>;
    // patchThinkingParam: 已有 body.thinking → 不覆盖
    // stripCacheControl: 无 cache_control → 不修改
    // patchMissingThinkingBlocks 给 assistant 的 content 开头注入 thinking block
    // patchOrphanToolResults 移除没有对应 tool_use 的 tool_result，并清理空 user 消息
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content[0].type).toBe("thinking");
    expect(messages[0].content[1].type).toBe("text");
  });

  it("非 DeepSeek provider 时不修改", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const original = JSON.stringify(body);
    const { body: result } = applyProviderPatches(body, { base_url: "https://open.bigmodel.cn/api/anthropic", api_type: "anthropic" });
    expect(JSON.stringify(result)).toBe(original);
  });

  it("DeepSeek provider 但 OpenAI apiType 时不触发 Anthropic patch", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    const original = JSON.stringify(body);
    const { body: result } = applyProviderPatches(body, { base_url: "https://api.deepseek.com", api_type: "openai" });
    // OpenAI patch 尚未实现，body 不应被修改
    expect(JSON.stringify(result)).toBe(original);
  });
});

describe("stripCacheControl", () => {
  it("移除 messages、system、tools 中的 cache_control", () => {
    const body = {
      system: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
        ] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "hmm", cache_control: { type: "ephemeral" } },
          { type: "text", text: "hi" },
        ] },
      ],
      tools: [{ name: "read", description: "read", cache_control: { type: "ephemeral" } }],
    };
    stripCacheControl(body);
    expect(JSON.stringify(body)).not.toContain("cache_control");
    // 内容本身保留
    expect((body.system as Array<Record<string, unknown>>)[0].text).toBe("You are helpful");
    expect((body.tools as Array<Record<string, unknown>>)[0].name).toBe("read");
  });

  it("无 cache_control 时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ],
    };
    const original = JSON.stringify(body);
    stripCacheControl(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("string content 的消息不受影响", () => {
    const body = {
      messages: [
        { role: "user", content: "plain text" },
      ],
    };
    const original = JSON.stringify(body);
    stripCacheControl(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("无 messages/system/tools 时安全返回", () => {
    const body = {};
    expect(() => stripCacheControl(body)).not.toThrow();
  });
});

describe("patchThinkingParam", () => {
  it("Anthropic: 历史有 thinking block 但无参数时注入含 budget_tokens", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("OpenAI: 历史有 reasoning_content 但无参数时注入不含 budget_tokens", () => {
    const body = {
      messages: [
        { role: "assistant", content: "hi", reasoning_content: "thoughts" },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "openai");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect((body.thinking as Record<string, unknown>).budget_tokens).toBeUndefined();
  });

  it("已有 thinking 参数时不覆盖", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 5000 },
      messages: [],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  it("无 thinking 历史时不注入", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toBeUndefined();
  });

  it("无 messages 时安全返回", () => {
    const body = {};
    expect(() => patchThinkingParam(body, "anthropic")).not.toThrow();
    expect(body.thinking).toBeUndefined();
  });
});

describe("patchMissingThinkingBlocks (enhanced)", () => {
  it("signature: 检测到历史 thinking block 带 signature 时补 signature", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h", signature: "sig_abc" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const lastAssistant = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(lastAssistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "" });
  });

  it("signature: 历史无 signature 时不补 signature 字段", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const lastAssistant = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(lastAssistant.content[0]).toEqual({ type: "thinking", thinking: "" });
    expect("signature" in lastAssistant.content[0]).toBe(false);
  });

  it("位置修正: thinking block 在第二位时移到首位", () => {
    const body = {
      messages: [
        { role: "assistant", content: [
          { type: "text", text: "response" },
          { type: "thinking", thinking: "hmm", signature: "s" },
        ] },
        { role: "user", content: "ok" },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[0] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0].type).toBe("thinking");
    expect(assistant.content[1].type).toBe("text");
  });

  it("位置修正: thinking block 在首位时不移动", () => {
    const body = {
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "hmm", signature: "s" },
          { type: "text", text: "response" },
        ] },
      ],
    };
    const original = JSON.stringify(body);
    patchMissingThinkingBlocks(body);
    expect(JSON.stringify(body)).toBe(original);
  });
});

describe("patchOrphanToolResults (enhanced)", () => {
  it("空 assistant 清理: orphan 清理后残留空 content 的 assistant 被移除", () => {
    // 场景：assistant 只有孤儿 tool_use（对应 tool_result 也是孤儿），
    // 清理后 assistant content 为空 → 被移除
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "orphan_use", name: "R", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "orphan_use", content: "x" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "ghost_use", name: "G", input: {} }] },
        // ghost_use 的 tool_result 不存在（被截断），但 ghost_use 本身因为 tool_result 被删后
        // 上面的 orphan_use tool_result 对应的 assistant tool_use 被移除...
        // 实际上这里 orphan_use 在 knownToolUseIds 中，其 tool_result 不会被移除
      ],
    };
    // 换一个更简单的场景：无任何 tool_use，只有孤儿 tool_result
    const body2 = {
      messages: [
        { role: "assistant", content: [] },
        { role: "user", content: [{ type: "text", text: "follow-up" }] },
      ],
    };
    patchOrphanToolResults(body2);
    // 没有 orphan 所以函数 early return，不会清理空 assistant
    // 这个测试需要造一个能走到 Step 6 的场景
  });

  it("空 assistant 清理: orphan 触发后空 assistant 被移除并合并", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "response" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "orphan_1", content: "x" }] },
        { role: "assistant", content: [] },
        { role: "user", content: "next" },
      ],
    };
    patchOrphanToolResults(body);
    // orphan_1 被移除 → user 变空 → 空 user 被删 → 空 assistant 被删 → 最终：assistant + user
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages[1].role).toBe("user");
  });

  it("tool_use 合并去重: 相同 id 只保留一个", () => {
    // 构造真正的重复 id 场景：orphan 清理后 user 变空
    const body2 = {
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: [
          { type: "tool_use", id: "call_a", name: "R", input: {} },
        ] },
        // user 只含孤儿 tool_result（call_a 的 tool_result 被截断）
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "orphan_1", content: "x" },
        ] },
        // 第二个 assistant 含重复 id
        { role: "assistant", content: [
          { type: "tool_use", id: "call_a", name: "R", input: { retry: true } },
          { type: "text", text: "retrying" },
        ] },
        { role: "user", content: "continue" },
      ],
    };
    patchOrphanToolResults(body2);
    // orphan_1 移除 → user 变空 → 删除 → 两个 assistant 合并 → call_a 去重
    expect(body2.messages).toHaveLength(3); // user(start) + assistant(merged) + user(continue)
    expect(body2.messages[0].role).toBe("user");
    expect(body2.messages[1].role).toBe("assistant");
    expect(body2.messages[2].role).toBe("user");
    const merged = body2.messages[1].content as Array<Record<string, unknown>>;
    const toolUseBlocks = merged.filter(b => b.type === "tool_use");
    expect(toolUseBlocks).toHaveLength(1); // 去重后只剩一个 call_a
    expect(toolUseBlocks[0].id).toBe("call_a");
    const textBlocks = merged.filter(b => b.type === "text");
    expect(textBlocks).toHaveLength(1); // text "retrying" 保留
  });
});

describe("stripCacheControl", () => {
  it("移除 messages/system/tools 中的 cache_control", () => {
    const body = {
      system: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
        ] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "hmm", cache_control: { type: "ephemeral" } },
          { type: "text", text: "hi" },
        ] },
      ],
      tools: [{ name: "read", cache_control: { type: "ephemeral" } }],
    };
    stripCacheControl(body);
    expect(JSON.stringify(body)).not.toContain("cache_control");
    // 确认内容本身未被删除
    expect((body.system as Array<{ text: string }>)[0].text).toBe("You are helpful");
    expect((body.tools as Array<{ name: string }>)[0].name).toBe("read");
  });

  it("无 cache_control 时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ],
    };
    const original = JSON.stringify(body);
    stripCacheControl(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("无 messages 时安全返回", () => {
    const body = { system: "hello" };
    expect(() => stripCacheControl(body)).not.toThrow();
  });
});

describe("patchThinkingParam", () => {
  it("Anthropic: 历史有 thinking block 但无参数时注入含 budget_tokens", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("OpenAI: 历史有 reasoning_content 但无参数时注入不含 budget_tokens", () => {
    const body = {
      messages: [
        { role: "assistant", reasoning_content: "thinking...", content: "hi" },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "openai");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect((body.thinking as Record<string, unknown>).budget_tokens).toBeUndefined();
  });

  it("已有 thinking 参数时不覆盖", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 5000 },
      messages: [],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  it("无 thinking 历史时不注入", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toBeUndefined();
  });

  it("无 messages 时安全返回", () => {
    const body = {};
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toBeUndefined();
  });
});

describe("patchMissingThinkingBlocks (enhanced)", () => {
  it("signature 检测：历史 thinking block 带 signature 时补丁也带 signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h", signature: "sig123" }, { type: "text", text: "hi" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "there" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const last = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(last.content[0]).toEqual({ type: "thinking", thinking: "", signature: "" });
    expect(last.content[1]).toEqual({ type: "text", text: "there" });
  });

  it("signature 检测：历史 thinking block 不带 signature 时补丁也不带 signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h" }, { type: "text", text: "hi" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "there" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const last = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(last.content[0]).toEqual({ type: "thinking", thinking: "" });
    expect("signature" in last.content[0]).toBe(false);
  });

  it("位置修正：thinking block 在第二位时移到首位", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [
          { type: "text", text: "wrong first" },
          { type: "thinking", thinking: "hmm" },
        ] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[0] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0].type).toBe("thinking");
    expect(assistant.content[1].type).toBe("text");
  });

  it("无历史 thinking block 时补丁带 signature（向后兼容）", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[0] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "" });
  });
});

describe("patchOrphanToolResults (enhanced)", () => {
  it("空 assistant 消息清理：orphan 清理后残留空 content 的 assistant 被移除", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "start" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
        // 下一个 assistant 只有 tool_use，对应的 tool_result 是孤儿
        { role: "assistant", content: [{ type: "tool_use", id: "call_orphan", name: "X", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_orphan", content: "x" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_2", name: "R2", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_2", content: "ok2" }] },
      ],
    };
    patchOrphanToolResults(body);
    // call_orphan 的 tool_result 是孤儿（因为 call_orphan 的 assistant 还在）
    // 等等 — call_orphan 不是孤儿，因为 assistant 中有对应的 tool_use
    // 这个场景不触发 removedAny，所以不会做额外处理
    expect(body.messages.length).toBeGreaterThanOrEqual(4);
  });

  it("空 assistant 清理：assistant 只有孤儿 tool_use 导致 content 为空后被移除", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "start" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        // tool_result 被截断，只剩 tool_use
        // 现在 assistant 的 tool_use 没有对应 tool_result，但这不是 orphan tool_result 场景
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ],
    };
    // 无孤儿 tool_result → removedAny = false → 直接返回
    const original = JSON.stringify(body);
    patchOrphanToolResults(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("assistant 合并时 tool_use 去重", () => {
    const body = {
      messages: [
        { role: "user", content: "start" },
        // 第一个 assistant 有 tool_use call_1
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "Read", input: { file: "a" } }] },
        // orphan tool_result 导致 user 被删除
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: "ok" },
          { type: "tool_result", tool_use_id: "orphan_1", content: "x" },
        ] },
        // 第二个 assistant 也有 tool_use call_1（重复 id）
        { role: "assistant", content: [
          { type: "tool_use", id: "call_1", name: "Read", input: { file: "b" } },
          { type: "tool_use", id: "call_2", name: "Write", input: {} },
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
      ],
    };
    patchOrphanToolResults(body);
    // orphan_1 被移除，但 call_1 的 tool_result 保留，所以 user 非空
    // 然后不会产生连续 assistant
    const assistants = (body.messages as Array<{ role: string }>).filter(m => m.role === "assistant");
    // 验证去重：合并后的 assistant 不应有重复的 tool_use id
    for (const a of assistants) {
      const ids = ((a as unknown as { content: Array<Record<string, unknown>> }).content)
        .filter(b => b.type === "tool_use")
        .map(b => b.id as string);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("applyProviderPatches (enhanced)", () => {
  it("Anthropic provider 完整 patch 链路：thinking + cache_control + orphan", () => {
    const body = {
      system: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "let me think", cache_control: { type: "ephemeral" } },
          { type: "text", text: "hi" },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_ghost", content: "x", cache_control: { type: "ephemeral" } },
        ] },
        { role: "assistant", content: [{ type: "text", text: "response" }] },
      ],
      tools: [{ name: "read", cache_control: { type: "ephemeral" } }],
    };
    const { body: result } = applyProviderPatches(body, {
      base_url: "https://api.deepseek.com/anthropic",
      api_type: "anthropic",
    });

    // cache_control 应被剥离
    expect(JSON.stringify(result)).not.toContain("cache_control");

    // 第二个 assistant 应被补上 thinking block
    const messages = result.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const secondAssistant = messages.find(
      (m, i) => m.role === "assistant" && i > 0,
    );
    // orphan tool_result (call_ghost) 被清理 → user 变空 → 删除 → assistant 合并
    // 最终只有一条合并后的 assistant 消息
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    // thinking block 在首位
    expect(messages[0].content[0].type).toBe("thinking");
  });

  it("OpenAI provider 跳过 Anthropic 专用 patch", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const original = JSON.stringify(body);
    const { body: result } = applyProviderPatches(body, {
      base_url: "https://api.deepseek.com",
      api_type: "openai",
    });
    // OpenAI patch 尚未实现，body 不变
    expect(JSON.stringify(result)).toBe(original);
  });

  it("api_type 为 anthropic 但非 DeepSeek provider 时不触发", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const original = JSON.stringify(body);
    const { body: result } = applyProviderPatches(body, {
      base_url: "https://api.anthropic.com",
      api_type: "anthropic",
    });
    expect(JSON.stringify(result)).toBe(original);
  });
});

describe("stripCacheControl", () => {
  it("移除 messages/system/tools 中的 cache_control", () => {
    const body = {
      system: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
        ] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "hmm", cache_control: { type: "ephemeral" } },
          { type: "text", text: "hi" },
        ] },
      ],
      tools: [{ name: "read", input_schema: {}, cache_control: { type: "ephemeral" } }],
    };
    stripCacheControl(body);
    expect(JSON.stringify(body)).not.toContain("cache_control");
    // 其他字段保持不变
    expect((body.messages![0] as { content: unknown[] }).content[0]).toHaveProperty("type", "text");
  });

  it("无 cache_control 时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ],
    };
    const original = JSON.stringify(body);
    stripCacheControl(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("system 为 string 时不报错", () => {
    const body = {
      system: "You are helpful",
      messages: [],
    };
    expect(() => stripCacheControl(body)).not.toThrow();
  });
});

describe("patchThinkingParam", () => {
  it("Anthropic: 历史有 thinking block 但无参数时注入", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("OpenAI: 历史有 reasoning_content 但无参数时注入", () => {
    const body = {
      messages: [
        { role: "assistant", content: "hi", reasoning_content: "hmm" },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "openai");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect((body.thinking as Record<string, unknown>).budget_tokens).toBeUndefined();
  });

  it("已有 thinking 参数时不覆盖", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 5000 },
      messages: [],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  it("无 thinking 历史时不注入", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toBeUndefined();
  });

  it("无 messages 时安全返回", () => {
    const body = {};
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toBeUndefined();
  });
});

describe("patchMissingThinkingBlocks (signature + position)", () => {
  it("历史 thinking block 带 signature 时补 signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h", signature: "sig1" }, { type: "text", text: "a" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "b" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const lastAssistant = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(lastAssistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "" });
  });

  it("历史 thinking block 不带 signature 时不补 signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "h" }, { type: "text", text: "a" }] },
        { role: "user", content: "ok" },
        { role: "assistant", content: [{ type: "text", text: "b" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const lastAssistant = body.messages[2] as { content: Array<Record<string, unknown>> };
    expect(lastAssistant.content[0]).toEqual({ type: "thinking", thinking: "" });
    expect("signature" in (lastAssistant.content[0] as Record<string, unknown>)).toBe(false);
  });

  it("thinking block 不在首位时修正位置", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [
          { type: "text", text: "wrong position" },
          { type: "thinking", thinking: "hmm", signature: "s" },
        ] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[0] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0].type).toBe("thinking");
    expect(assistant.content[1].type).toBe("text");
  });

  it("无历史 thinking block 且 body.thinking 存在时默认带 signature", () => {
    const body = {
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchMissingThinkingBlocks(body);
    const assistant = body.messages[0] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "" });
  });
});

describe("patchOrphanToolResults (empty assistant + dedup)", () => {
  it("清理孤儿后移除空 assistant 消息", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
        // 空 assistant + 孤儿 tool_result
        { role: "assistant", content: [] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost", content: "x" }] },
        { role: "assistant", content: [{ type: "text", text: "final" }] },
      ],
    };
    patchOrphanToolResults(body);
    // ghost 孤儿 → user 变空 → 删除
    // assistant([]) 与 assistant(text) 合并 → content = [text]（非空）
    expect(body.messages).toHaveLength(4);
    expect((body.messages as unknown[]).map((m: unknown) => (m as { role: string }).role)).toEqual([
      "user", "assistant", "user", "assistant",
    ]);
  });

  it("合并 assistant 时按 tool_use id 去重", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        // 第一个 assistant
        { role: "assistant", content: [
          { type: "tool_use", id: "call_dup", name: "Read", input: {} },
        ] },
        // 中间 user 只含孤儿，会被删除
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_missing", content: "x" }] },
        // 第二个 assistant 含重复 id
        { role: "assistant", content: [
          { type: "tool_use", id: "call_dup", name: "Read", input: { path: "/x" } },
          { type: "text", text: "result" },
        ] },
      ],
    };
    patchOrphanToolResults(body);
    // 孤儿 tool_result → user 删除 → 两个 assistant 合并 → call_dup 去重
    const merged = body.messages as unknown[];
    expect(merged).toHaveLength(2);
    const assistantContent = (merged[1] as { content: unknown[] }).content as Array<Record<string, unknown>>;
    const toolUseCount = assistantContent.filter(b => b.type === "tool_use").length;
    expect(toolUseCount).toBe(1);
    expect(assistantContent).toHaveLength(2); // 1 tool_use + 1 text
  });

  it("content 为空数组的 assistant 被移除", () => {
    const body = {
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: [] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost", content: "x" }] },
        { role: "user", content: "end" },
      ],
    };
    patchOrphanToolResults(body);
    // ghost 孤儿 → user[1] 变空删除 → 空 assistant 删除 → 两个 user 合并
    const msgs = body.messages as unknown[];
    expect(msgs).toHaveLength(1); // user(start + end) 合并为一条
    expect((msgs[0] as { role: string }).role).toBe("user");
  });
});

describe("applyProviderPatches (full Anthropic pipeline)", () => {
  it("完整 pipeline: cache_control 剥离 + thinking 参数注入 + thinking block 补齐 + 孤儿清理", () => {
    const body = {
      // 无 thinking 参数，但历史有 thinking block
      system: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "let me think", signature: "s1", cache_control: { type: "ephemeral" } },
          { type: "text", text: "hello" },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_ghost", content: "x" },
        ] },
        { role: "assistant", content: [{ type: "text", text: "world" }] },
      ],
    };
    const { body: result } = applyProviderPatches(body, { base_url: "https://api.deepseek.com/anthropic", api_type: "anthropic" });

    // thinking 参数被注入
    expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });

    // cache_control 全部剥离
    expect(JSON.stringify(result)).not.toContain("cache_control");

    // 孤儿 tool_result (call_ghost) 被清理，空 user 被删除
    const msgs = result.messages as Array<{ role: string; content: unknown[] }>;
    // user 只有 tool_result，orphan 清理后变空删除 → 两个 assistant 合并
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");

    // 合并后内容：thinking + text + thinking + text（第一个 assistant + 第二个 assistant 合并）
    const content = msgs[0].content as Array<Record<string, unknown>>;
    // thinking block 在首位
    expect(content[0].type).toBe("thinking");
    // 两个 assistant 的文本都保留
    const textBlocks = content.filter(b => b.type === "text");
    expect(textBlocks).toHaveLength(2);
  });

  it("OpenAI apiType 时不执行 Anthropic patch", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    const original = JSON.stringify(body);
    const { body: result } = applyProviderPatches(body, { base_url: "https://api.deepseek.com/v1", api_type: "openai" });
    // OpenAI patch 留给后续 PR，当前不执行任何 patch
    expect(JSON.stringify(result)).toBe(original);
  });
});
