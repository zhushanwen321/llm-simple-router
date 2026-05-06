import { describe, it, expect, beforeEach } from "vitest";
import { ProxyAgentFactory } from "../src/proxy/transport/proxy-agent.js";

describe("ProxyAgentFactory", () => {
  let factory: ProxyAgentFactory;

  beforeEach(() => {
    factory = new ProxyAgentFactory();
  });

  it("returns undefined when proxy_type is null", () => {
    const agent = factory.getAgent({
      id: "p1", proxy_type: null, proxy_url: null, proxy_username: null, proxy_password: null,
    });
    expect(agent).toBeUndefined();
  });

  it("returns undefined when proxy_url is null", () => {
    const agent = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: null, proxy_username: null, proxy_password: null,
    });
    expect(agent).toBeUndefined();
  });

  it("creates agent for HTTP proxy type", () => {
    const agent = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null,
    });
    expect(agent).toBeDefined();
  });

  it("creates agent for SOCKS5 proxy type", () => {
    const agent = factory.getAgent({
      id: "p1", proxy_type: "socks5", proxy_url: "socks5://127.0.0.1:1080", proxy_username: null, proxy_password: null,
    });
    expect(agent).toBeDefined();
  });

  it("returns cached agent on second call", () => {
    const first = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null,
    });
    const second = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null,
    });
    expect(first).toBe(second);
  });

  it("creates new agent when URL changes", () => {
    const first = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null,
    });
    const second = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:8080", proxy_username: null, proxy_password: null,
    });
    expect(first).not.toBe(second);
  });

  it("invalidate removes cached agent", () => {
    const agent = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null,
    });
    factory.invalidate("p1");
    const after = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null,
    });
    expect(after).not.toBe(agent);
  });

  it("invalidateAll clears all caches", () => {
    factory.getAgent({ id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null });
    factory.getAgent({ id: "p2", proxy_type: "socks5", proxy_url: "socks5://127.0.0.1:1080", proxy_username: null, proxy_password: null });
    factory.invalidateAll();
    const a1 = factory.getAgent({ id: "p1", proxy_type: "http", proxy_url: "http://127.0.0.1:7890", proxy_username: null, proxy_password: null });
    expect(a1).toBeDefined();
  });

  it("builds proxy URL with embedded credentials without throwing", () => {
    const agent = factory.getAgent({
      id: "p1", proxy_type: "http", proxy_url: "http://proxy.example.com:8080", proxy_username: "user", proxy_password: "pass",
    });
    expect(agent).toBeDefined();
  });

  it("invalidate non-existent provider is a no-op", () => {
    expect(() => factory.invalidate("nonexistent")).not.toThrow();
  });
});
