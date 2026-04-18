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

  it("整条移除包含 router:command= 的 user message", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "normal" }] },
        { role: "assistant", content: [{ type: "text", text: "response" }] },
        { role: "user", content: [{ type: "text", text: "<!-- router:command=select-model -->" }] },
        { role: "assistant", content: [{ type: "text", text: "<router-response type=\"model-list\">可用模型:</router-response>" }] },
        { role: "user", content: [{ type: "text", text: "next message" }] },
      ],
    };
    const result = cleanRouterResponses(body);
    const msgs = result.messages!;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content[0].text).toBe("normal");
    expect(msgs[2].content[0].text).toBe("next message");
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
});
