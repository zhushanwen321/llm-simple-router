import { describe, it, expect } from "vitest";
import { parseDirective } from "../src/proxy/enhancement/directive-parser.js";

describe("parseDirective", () => {
  const baseBody = (text: string) => ({
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    stream: true,
  });

  it("解析 $SELECT-MODEL 指令", () => {
    const result = parseDirective(baseBody("$SELECT-MODEL=glm-5.1"));
    expect(result.modelName).toBe("glm-5.1");
    expect(result.command).toBeNull();
    const cleaned = result.cleanedBody.messages![0].content[0].text;
    expect(cleaned).not.toContain("$SELECT-MODEL");
  });

  it("解析 [router-model] 标签指令", () => {
    const result = parseDirective(
      baseBody("hello [router-model: deepseek-v3]")
    );
    expect(result.modelName).toBe("deepseek-v3");
    const cleaned = result.cleanedBody.messages![0].content[0].text;
    expect(cleaned).not.toContain("router-model");
    expect(cleaned).toContain("hello");
  });

  it("解析 [router-command] 指令", () => {
    const result = parseDirective(
      baseBody("[router-command: select-model]")
    );
    expect(result.command).toBe("select-model");
    expect(result.isCommandMessage).toBe(true);
  });

  it("解析 [router-command] 带参数", () => {
    const result = parseDirective(
      baseBody("[router-command: select-model A]")
    );
    expect(result.command).toBe("select-model A");
    expect(result.isCommandMessage).toBe(true);
  });

  it("无指令时返回 null", () => {
    const result = parseDirective(baseBody("normal message"));
    expect(result.modelName).toBeNull();
    expect(result.command).toBeNull();
    expect(result.isCommandMessage).toBe(false);
  });

  it("仅扫描最后一条 user 消息", () => {
    const body = {
      model: "opus",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "$SELECT-MODEL=old" }],
        },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "new message" }] },
      ],
    };
    const result = parseDirective(body);
    expect(result.modelName).toBeNull();
  });

  it("模型名校验：拒绝纯数字", () => {
    const result = parseDirective(baseBody("$SELECT-MODEL=12345"));
    expect(result.modelName).toBeNull();
  });

  it("模型名校验：拒绝以点开头", () => {
    const result = parseDirective(baseBody("$SELECT-MODEL=.hidden"));
    expect(result.modelName).toBeNull();
  });

  it("模型名校验：拒绝超长名称", () => {
    const long = "a".repeat(129);
    const result = parseDirective(baseBody(`$SELECT-MODEL=${long}`));
    expect(result.modelName).toBeNull();
  });

  it("不扫描 tool_result 类型", () => {
    const body = {
      model: "opus",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "x",
              content: "$SELECT-MODEL=glm-5.1",
            },
            { type: "text", text: "normal" },
          ],
        },
      ],
    };
    const result = parseDirective(body);
    expect(result.modelName).toBeNull();
  });

  it("default 指令返回特殊标记", () => {
    const result = parseDirective(baseBody("$SELECT-MODEL=default"));
    expect(result.modelName).toBe("default");
  });
});
