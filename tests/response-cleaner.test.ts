import { describe, it, expect } from "vitest";
import { cleanRouterResponses } from "../src/proxy/response-cleaner.js";

describe("cleanRouterResponses", () => {
  it("移除 <router-response> 标签及其内容", () => {
    const body = {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "hello\n\n<router-response type=\"model-info\">当前模型: glm-5.1</router-response>" }],
      }],
    };
    const result = cleanRouterResponses(body);
    const text = result.messages![0].content[0].text;
    expect(text).toBe("hello");
  });

  it("保留最后一条 user 消息（即使包含命令），只移除历史的命令消息", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "normal" }] },
        { role: "assistant", content: [{ type: "text", text: "response" }] },
        { role: "user", content: [{ type: "text", text: "[router-command: select-model]" }] },
        { role: "assistant", content: [{ type: "text", text: "<router-response type=\"model-list\">1. glm-5.1</router-response>" }] },
        { role: "user", content: [{ type: "text", text: "[router-command: select-model glm-5.1]" }] },
      ],
    };
    const result = cleanRouterResponses(body);
    const msgs = result.messages!;
    // 历史 user (idx 0) 保留, 历史 assistant (idx 1) 保留
    // 历史 user command (idx 2) 移除, 历史 pure router-response (idx 3) 移除
    // 最后一条 user (idx 4) 保留
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content[0].text).toBe("normal");
    expect(msgs[1].content[0].text).toBe("response");
    expect(msgs[2].content[0].text).toBe("[router-command: select-model glm-5.1]");
  });

  it("移除所有纯 <router-response> 的 assistant 消息", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "normal" }] },
        { role: "assistant", content: [{ type: "text", text: "<router-response type=\"model-selected\">已选择: glm-5.1</router-response>" }] },
      ],
    };
    const result = cleanRouterResponses(body);
    const msgs = result.messages!;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0].text).toBe("normal");
  });

  it("无标签时不变", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] };
    const result = cleanRouterResponses(body);
    expect(result.messages![0].content[0].text).toBe("hello");
  });

  it("处理多行 <router-response>", () => {
    const body = {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "line1\n\n<router-response type=\"model-list\">\n可用模型:\nA. glm-5.1\n</router-response>\n\nline2" }],
      }],
    };
    const result = cleanRouterResponses(body);
    const text = result.messages![0].content[0].text;
    expect(text).toBe("line1\n\nline2");
  });

  it("最后一条 user 消息中的 <router-response> 标签也会被剥离", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hello <router-response>leftover</router-response> world" }] },
      ],
    };
    const result = cleanRouterResponses(body);
    expect(result.messages!).toHaveLength(1);
    expect(result.messages![0].content[0].text).toBe("hello  world");
  });
});
