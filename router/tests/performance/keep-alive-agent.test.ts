/**
 * BP-C1: HTTP Agent keep-alive 连接池测试
 *
 * 验证无代理配置的 provider 使用 keep-alive agent 复用 TCP 连接。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ProxyAgentFactory } from "../../src/proxy/transport/proxy-agent.js";
import * as http from "http";
import * as https from "https";

describe("ProxyAgentFactory keep-alive agent", () => {
  let factory: ProxyAgentFactory;

  beforeEach(() => {
    factory = new ProxyAgentFactory();
  });

  it("getKeepAliveAgent 返回 http.Agent 用于 http URL", () => {
    const agent = factory.getKeepAliveAgent("http://api.example.com/v1/chat");
    expect(agent).toBeDefined();
    expect(agent).toBeInstanceOf(http.Agent);
  });

  it("getKeepAliveAgent 返回 https.Agent 用于 https URL", () => {
    const agent = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    expect(agent).toBeDefined();
    // https.Agent 继承自 http.Agent
    expect(agent).toBeInstanceOf(http.Agent);
  });

  it("keep-alive agent 配置了 keepAlive: true", () => {
    const agent = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    // Agent 的 options 中 keepAlive 应为 true
    expect((agent as http.Agent & { keepAlive: boolean }).keepAlive).toBe(true);
  });

  it("多次调用返回同一 agent 实例（同协议复用）", () => {
    const a1 = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    const a2 = factory.getKeepAliveAgent("https://api.anthropic.com/v1/messages");
    expect(a1).toBe(a2);
  });

  it("http 和 https 返回不同 agent", () => {
    const httpAgent = factory.getKeepAliveAgent("http://localhost:9000/v1/chat");
    const httpsAgent = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    expect(httpAgent).not.toBe(httpsAgent);
  });

  it("destroy() 清理所有 keep-alive agent", () => {
    const httpAgent = factory.getKeepAliveAgent("http://localhost:9000/v1/chat");
    const httpsAgent = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    factory.destroy();
    // destroy 后再获取应该是新实例
    const newHttpAgent = factory.getKeepAliveAgent("http://localhost:9000/v1/chat");
    expect(newHttpAgent).not.toBe(httpAgent);
  });

  it("invalidateAll 同时清理 keep-alive agent 和 proxy agent", () => {
    const httpsAgent = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    // 同时创建一个 proxy agent
    factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890",
      proxy_username: null, proxy_password: null,
    });
    factory.invalidateAll();
    const newHttpsAgent = factory.getKeepAliveAgent("https://api.openai.com/v1/chat");
    expect(newHttpsAgent).not.toBe(httpsAgent);
  });
});
