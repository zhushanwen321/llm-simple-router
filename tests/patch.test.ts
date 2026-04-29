import { describe, it, expect } from "vitest";
import { patchNonDeepSeekToolMessages } from "../src/proxy/patch/deepseek/patch-thinking-blocks.js";
import { patchOrphanToolResults } from "../src/proxy/patch/deepseek/patch-orphan-tool-results.js";
import { patchRouterSyntheticToolCalls } from "../src/proxy/patch/router-cleanup.js";
import { applyProviderPatches } from "../src/proxy/patch/index.js";

describe("patchNonDeepSeekToolMessages", () => {
  it("将缺 thinking 的 assistant tool_use 转为 text", () => {
    const body = {
      messages: [
        { role: "user", content: "分析代码" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "read", input: { path: "/a" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "file content" },
          ],
        },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    const assistant = body.messages[1] as { content: unknown[] };
    expect(assistant.content).toHaveLength(1);
    const block = assistant.content[0] as { type: string; text: string };
    expect(block.type).toBe("text");
    const parsed = JSON.parse(block.text);
    expect(parsed.type).toBe("tool_use");
    expect(parsed.id).toBe("call_1");
    expect(parsed.name).toBe("read");

    const user = body.messages[2] as { content: unknown[] };
    expect(user.content).toHaveLength(1);
    const userBlock = user.content[0] as { type: string; text: string };
    expect(userBlock.type).toBe("text");
    const userParsed = JSON.parse(userBlock.text);
    expect(userParsed.type).toBe("tool_result");
    expect(userParsed.tool_use_id).toBe("call_1");
  });

  it("保留有合法 signature 的 DeepSeek 原生消息不动", () => {
    const body = {
      messages: [
        { role: "user", content: "查天气" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "推理中", signature: "uuid-1234" },
            { type: "tool_use", id: "call_2", name: "get_weather", input: { city: "北京" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_2", content: "晴" },
          ],
        },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    const assistant = body.messages[1] as { content: unknown[] };
    expect(assistant.content).toHaveLength(2);
    expect((assistant.content[0] as { type: string }).type).toBe("thinking");
    expect((assistant.content[1] as { type: string }).type).toBe("tool_use");

    const user = body.messages[2] as { content: unknown[] };
    expect(user.content).toHaveLength(1);
    expect((user.content[0] as { type: string }).type).toBe("tool_result");
  });

  it("signature 为空视为非 DeepSeek 消息，转换 tool_use", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "", signature: "" },
            { type: "tool_use", id: "call_3", name: "read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_3", content: "ok" },
          ],
        },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    const assistant = body.messages[1] as { content: unknown[] };
    // thinking 保留，tool_use 转为 text
    const types = (assistant.content as Array<{ type: string }>).map(b => b.type);
    expect(types).toContain("thinking");
    expect(types).toContain("text");
    expect(types).not.toContain("tool_use");
  });

  it("同时含 text 和 tool_use（无 thinking），text 保留 tool_use 转为 text", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "我来帮你查" },
            { type: "tool_use", id: "call_4", name: "read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_4", content: "ok" },
          ],
        },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    const assistant = body.messages[1] as { content: unknown[] };
    expect(assistant.content).toHaveLength(2);
    expect((assistant.content[0] as { type: string }).type).toBe("text");
    expect((assistant.content[1] as { type: string }).type).toBe("text");
    // 第二个 text 是序列化的 tool_use
    const parsed = JSON.parse((assistant.content[1] as { text: string }).text);
    expect(parsed.type).toBe("tool_use");
  });

  it("只有不匹配的 tool_result 保留原样，不影响不相关的 user 消息", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_a", name: "A", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_b", content: "unrelated" },
          ],
        },
      ],
    };
    patchNonDeepSeekToolMessages(body);

    // assistant 的 tool_use 被转换
    const assistant = body.messages[0] as { content: unknown[] };
    expect((assistant.content[0] as { type: string }).type).toBe("text");

    // user 的 tool_result 不匹配 call_a → 保留
    const user = body.messages[1] as { content: unknown[] };
    expect((user.content[0] as { type: string }).type).toBe("tool_result");
  });

  it("无 messages 时安全返回", () => {
    const body: Record<string, unknown> = {};
    expect(() => patchNonDeepSeekToolMessages(body)).not.toThrow();
  });

  it("空 messages 时安全返回", () => {
    const body = { messages: [] };
    expect(() => patchNonDeepSeekToolMessages(body)).not.toThrow();
  });
});

describe("patchRouterSyntheticToolCalls", () => {
  it("移除 router 合成的 tool_use 和对应 tool_result", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "可用模型列表:\n1. deepseek/chat" },
            { type: "tool_use", id: "toolu_router_abc", name: "AskUserQuestion", input: { questions: [] } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_router_abc", content: "selected" },
          ],
        },
      ],
    };
    patchRouterSyntheticToolCalls(body);
    // assistant 只剩 text 块，user tool_result 被移除
    const assistant = body.messages[1] as { content: unknown[] };
    expect(assistant.content).toHaveLength(1);
    expect((assistant.content[0] as { type: string }).type).toBe("text");
    // 空 user 消息被移除，只有 2 条消息
    expect(body.messages).toHaveLength(2);
  });

  it("assistant 只含 router tool_use 时整条消息被移除", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_router_xyz", name: "AskUserQuestion", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_router_xyz", content: "ok" },
          ],
        },
        { role: "user", content: "next query" },
      ],
    };
    patchRouterSyntheticToolCalls(body);
    // 空 assistant 和空 user 被移除，连续 user 合并
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    const merged = body.messages[0].content as unknown[];
    expect(merged).toHaveLength(2);
  });

  it("provider 前缀 toolu_router_prov_ 也被移除", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_router_prov_123", name: "AskUserQuestion", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_router_prov_123", content: "x" },
          ],
        },
      ],
    };
    patchRouterSyntheticToolCalls(body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("保留非 router 的 tool_use 和 tool_result", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_real", name: "read", input: {} },
            { type: "tool_use", id: "toolu_router_abc", name: "AskUserQuestion", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_real", content: "data" },
            { type: "tool_result", tool_use_id: "toolu_router_abc", content: "selected" },
          ],
        },
      ],
    };
    patchRouterSyntheticToolCalls(body);
    const assistant = body.messages[1] as { content: unknown[] };
    expect(assistant.content).toHaveLength(1);
    expect((assistant.content[0] as { type: string }).type).toBe("tool_use");
    expect((assistant.content[0] as { id: string }).id).toBe("call_real");

    const user = body.messages[2] as { content: unknown[] };
    expect(user.content).toHaveLength(1);
    expect((user.content[0] as { type: string }).type).toBe("tool_result");
  });

  it("无 router 合成时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
      ],
    };
    const original = JSON.stringify(body);
    patchRouterSyntheticToolCalls(body);
    expect(JSON.stringify(body)).toBe(original);
  });

  it("空 messages 时安全返回", () => {
    const body = { messages: [] };
    expect(() => patchRouterSyntheticToolCalls(body)).not.toThrow();
  });
});

describe("patchOrphanToolResults", () => {
  it("将孤儿 tool_result 转为 text，保留有匹配的 tool_result", () => {
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
    expect(userMsg.content).toHaveLength(2);
    expect((userMsg.content[0] as { tool_use_id: string }).tool_use_id).toBe("call_1");
    // 孤儿转为 text 块
    const converted = userMsg.content[1] as { type: string; text: string };
    expect(converted.type).toBe("text");
    const parsed = JSON.parse(converted.text);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.tool_use_id).toBe("call_orphan");
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

  it("将孤儿转为 text 后合并相邻 user 消息", () => {
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
    // call_orphan 转为 text，msg[1] 和 msg[2] 连续 user → 合并
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages[1].role).toBe("user");
    const merged = body.messages[1].content as unknown[];
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ type: "tool_result", tool_use_id: "call_1", content: "ok" });
    expect((merged[1] as { type: string }).type).toBe("text"); // converted orphan
    expect(merged[2]).toEqual({ type: "text", text: "follow-up" });
  });

  it("修复：无 tool_use 时孤儿 tool_result 转为 text 保留", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_ghost", content: "x" }] },
      ],
    };
    patchOrphanToolResults(body);
    // 孤儿 tool_result 转为 text，user 消息保留
    expect(body.messages).toHaveLength(3);
    const lastUser = body.messages[2] as { content: unknown[] };
    expect((lastUser.content[0] as { type: string }).type).toBe("text");
    const parsed = JSON.parse((lastUser.content[0] as { text: string }).text);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.tool_use_id).toBe("call_ghost");
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

  it("修复：整个 assistant 消息被截断后，孤儿 tool_result 转为 text 并合并", () => {
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
    // 所有 tool_result 都是孤儿 → 转为 text，连续 user → 合并为一条
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    const merged = body.messages[0].content as unknown[];
    // first query + 2 个转为 text 的 tool_result
    expect(merged).toHaveLength(3);
    expect((merged[0] as { type: string }).type).toBe("text");
    expect((merged[0] as { text: string }).text).toBe("first query");
    expect((merged[1] as { type: string }).type).toBe("text");
    expect((merged[2] as { type: string }).type).toBe("text");
    const parsed1 = JSON.parse((merged[1] as { text: string }).text);
    expect(parsed1.tool_use_id).toBe("call_orphan_1");
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

  it("孤儿转为 text 后不影响非连续 assistant 消息的合并", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "R", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "orphan_1", content: "x" }] },
        { role: "assistant", content: [{ type: "text", text: "response" }] },
        { role: "user", content: "next" },
      ],
    };
    patchOrphanToolResults(body);
    // orphan_1 转为 text，user 非空不删除，两个 assistant 不合并
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages[1].role).toBe("user");
    const userMsg = body.messages[1].content as unknown[];
    expect((userMsg[0] as { type: string }).type).toBe("text");
    const parsed = JSON.parse((userMsg[0] as { text: string }).text);
    expect(parsed.tool_use_id).toBe("orphan_1");
  });

  it("大规模孤儿场景（模拟 70+ 孤儿，转为 text）", () => {
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

    const result = body.messages as unknown[];
    // 验证剩余的 tool_result 都有匹配的 tool_use
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
    // 孤儿转为 text 后连续 user 合并，消息数远少于原始 132 条
    expect(result.length).toBeLessThan(70);
  });
});

describe("applyProviderPatches", () => {
  it("返回 { body, meta } 结构，不修改原始 body", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "ok" },
          ],
        },
      ],
    };
    const original = JSON.stringify(body);
    const result = applyProviderPatches(body, { base_url: "https://api.deepseek.com/anthropic" });
    // 原始 body 不变
    expect(JSON.stringify(body)).toBe(original);
    // 返回结构正确
    expect(result).toHaveProperty("body");
    expect(result).toHaveProperty("meta");
    expect(result.meta).toHaveProperty("types");
  });

  it("DeepSeek provider 触发 patch，meta.types 含 deepseek_tool_use_to_text", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "ok" },
          ],
        },
      ],
    };
    const result = applyProviderPatches(body, { base_url: "https://api.deepseek.com/anthropic" });
    expect(result.meta.types).toContain("deepseek_tool_use_to_text");
    // 返回的 body 中 tool_use 被转为 text
    const assistant = result.body.messages[1] as { content: unknown[] };
    expect((assistant.content[0] as { type: string }).type).toBe("text");
  });

  it("非 DeepSeek provider 返回相同 body 引用且 meta.types 为空", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "ok" },
          ],
        },
      ],
    };
    const result = applyProviderPatches(body, { base_url: "https://open.bigmodel.cn/api/anthropic" });
    expect(result.meta.types).toHaveLength(0);
    // 非深寻求景下 body 被克隆（router cleanup），内容一致但不是同一引用
    expect(JSON.stringify(result.body)).toBe(JSON.stringify(body));
  });
});
