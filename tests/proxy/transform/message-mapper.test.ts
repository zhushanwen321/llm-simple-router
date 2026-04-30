import { describe, it, expect } from "vitest";
import { extractSystemMessages, convertMessagesOA2Ant, convertMessagesAnt2OA } from "../../../src/proxy/transform/message-mapper.js";

// ---------- extractSystemMessages ----------

describe("extractSystemMessages", () => {
  it("extracts single system message from front", () => {
    const msgs = [{ role: "system", content: "You are helpful" }, { role: "user", content: "Hi" }];
    const { systemParts, nonSystemMsgs } = extractSystemMessages(msgs);
    expect(systemParts).toEqual(["You are helpful"]);
    expect(nonSystemMsgs).toHaveLength(1);
    expect((nonSystemMsgs[0] as Record<string, unknown>).role).toBe("user");
  });

  it("extracts multiple system messages", () => {
    const msgs = [{ role: "system", content: "A" }, { role: "system", content: "B" }, { role: "user", content: "Hi" }];
    const { systemParts } = extractSystemMessages(msgs);
    expect(systemParts).toEqual(["A", "B"]);
  });

  it("returns empty systemParts when no system messages", () => {
    const msgs = [{ role: "user", content: "Hi" }];
    const { systemParts } = extractSystemMessages(msgs);
    expect(systemParts).toEqual([]);
  });
});

// ---------- convertMessagesOA2Ant ----------

describe("convertMessagesOA2Ant", () => {
  it("extracts system and converts basic user/assistant messages", () => {
    const msgs = [
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const { system, messages } = convertMessagesOA2Ant(msgs);
    expect(system).toBe("Be helpful");
    expect(messages).toHaveLength(2);
    expect((messages[0] as Record<string, unknown>).role).toBe("user");
    expect((messages[1] as Record<string, unknown>).role).toBe("assistant");
  });

  it("converts assistant with text and tool_calls to content blocks", () => {
    const msgs = [{
      role: "assistant", content: "Let me check",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"NYC\"}" } }],
    }];
    const { messages } = convertMessagesOA2Ant(msgs);
    // assistant as first msg triggers empty user prepend, so assistant is [1]
    const content = (messages[1] as Record<string, unknown>).content as unknown[];
    expect(content).toEqual([
      { type: "text", text: "Let me check" },
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "NYC" } },
    ]);
  });

  it("converts assistant with only tool_calls (no text content)", () => {
    const msgs = [{
      role: "assistant", content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "fn", arguments: "{}" } }],
    }];
    const { messages } = convertMessagesOA2Ant(msgs);
    // assistant as first msg triggers empty user prepend
    const content = (messages[1] as Record<string, unknown>).content as unknown[];
    expect(content).toHaveLength(1);
    expect((content[0] as Record<string, unknown>).type).toBe("tool_use");
  });

  it("merges consecutive tool messages into single user message", () => {
    const msgs = [
      { role: "tool", tool_call_id: "c1", content: "72F" },
      { role: "tool", tool_call_id: "c2", content: "Sunny" },
    ];
    const { messages } = convertMessagesOA2Ant(msgs);
    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).role).toBe("user");
    const content = (messages[0] as Record<string, unknown>).content as unknown[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "tool_result", tool_use_id: "c1", content: "72F" });
    expect(content[1]).toEqual({ type: "tool_result", tool_use_id: "c2", content: "Sunny" });
  });

  it("merges tool result into preceding user message", () => {
    const msgs = [
      { role: "user", content: "Check weather" },
      { role: "tool", tool_call_id: "c1", content: "72F" },
    ];
    const { messages } = convertMessagesOA2Ant(msgs);
    // tool after user should merge into that user message
    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).role).toBe("user");
    const content = (messages[0] as Record<string, unknown>).content as unknown[];
    expect(content).toHaveLength(2);
    expect((content[0] as Record<string, unknown>).type).toBe("text");
    expect((content[1] as Record<string, unknown>).type).toBe("tool_result");
  });

  it("enforces alternation by merging consecutive same-role messages", () => {
    const msgs = [
      { role: "user", content: "A" },
      { role: "user", content: "B" },
    ];
    const { messages } = convertMessagesOA2Ant(msgs);
    expect(messages).toHaveLength(1);
    const content = (messages[0] as Record<string, unknown>).content as unknown[];
    expect(content).toHaveLength(2);
  });

  it("prepends empty user message when first message is assistant", () => {
    const msgs = [{ role: "assistant", content: "Hi" }];
    const { messages } = convertMessagesOA2Ant(msgs);
    expect(messages).toHaveLength(2);
    expect((messages[0] as Record<string, unknown>).role).toBe("user");
    expect((messages[1] as Record<string, unknown>).role).toBe("assistant");
  });

  it("normalizes string content to content blocks array", () => {
    const msgs = [{ role: "user", content: "Hello" }];
    const { messages } = convertMessagesOA2Ant(msgs);
    const content = (messages[0] as Record<string, unknown>).content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as unknown[])[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("handles content array with text parts", () => {
    const msgs = [{ role: "user", content: [{ type: "text", text: "Hello" }] }];
    const { messages } = convertMessagesOA2Ant(msgs);
    const content = (messages[0] as Record<string, unknown>).content as unknown[];
    expect(content[0]).toEqual({ type: "text", text: "Hello" });
  });

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
});

// ---------- convertMessagesAnt2OA ----------

describe("convertMessagesAnt2OA", () => {
  it("converts system to role:system message and basic messages", () => {
    const messages = convertMessagesAnt2OA("Be helpful", [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    ]);
    expect((messages[0] as Record<string, unknown>).role).toBe("system");
    expect((messages[0] as Record<string, unknown>).content).toBe("Be helpful");
    expect((messages[1] as Record<string, unknown>).role).toBe("user");
    expect((messages[1] as Record<string, unknown>).content).toBe("Hi");
    expect((messages[2] as Record<string, unknown>).role).toBe("assistant");
  });

  it("converts tool_use blocks to tool_calls", () => {
    const messages = convertMessagesAnt2OA(undefined, [{
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "NYC" } }],
    }]);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.role).toBe("assistant");
    const toolCalls = msg.tool_calls as unknown[];
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as Record<string, unknown>).id).toBe("toolu_1");
    expect(((toolCalls[0] as Record<string, unknown>).function as Record<string, unknown>).name).toBe("get_weather");
  });

  it("converts assistant with both text and tool_use", () => {
    const messages = convertMessagesAnt2OA(undefined, [{
      role: "assistant",
      content: [
        { type: "text", text: "Let me check" },
        { type: "tool_use", id: "toolu_1", name: "fn", input: {} },
      ],
    }]);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.content).toBe("Let me check");
    expect(msg.tool_calls).toBeDefined();
    expect((msg.tool_calls as unknown[]).length).toBe(1);
  });

  it("splits tool_result blocks into separate role:tool messages", () => {
    const messages = convertMessagesAnt2OA(undefined, [{
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "72F" },
        { type: "tool_result", tool_use_id: "t2", content: "Sunny" },
      ],
    }]);
    expect(messages).toHaveLength(2);
    expect((messages[0] as Record<string, unknown>).role).toBe("tool");
    expect((messages[0] as Record<string, unknown>).tool_call_id).toBe("t1");
    expect((messages[1] as Record<string, unknown>).role).toBe("tool");
    expect((messages[1] as Record<string, unknown>).tool_call_id).toBe("t2");
  });

  it("handles user message with both text and tool_result", () => {
    const messages = convertMessagesAnt2OA(undefined, [{
      role: "user",
      content: [
        { type: "text", text: "Here is the result" },
        { type: "tool_result", tool_use_id: "t1", content: "72F" },
      ],
    }]);
    // text part becomes user message, tool_result becomes separate tool message
    expect(messages).toHaveLength(2);
    expect((messages[0] as Record<string, unknown>).role).toBe("user");
    expect((messages[0] as Record<string, unknown>).content).toBe("Here is the result");
    expect((messages[1] as Record<string, unknown>).role).toBe("tool");
  });

  it("handles system as content blocks array", () => {
    const messages = convertMessagesAnt2OA(
      [{ type: "text", text: "Rule A" }, { type: "text", text: "Rule B" }],
      [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    );
    expect((messages[0] as Record<string, unknown>).role).toBe("system");
    expect((messages[0] as Record<string, unknown>).content).toBe("Rule A\nRule B");
  });

  it("returns messages unchanged when system is undefined", () => {
    const messages = convertMessagesAnt2OA(undefined, [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ]);
    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).role).toBe("user");
  });
});
