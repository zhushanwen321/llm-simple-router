import * as http from "http";
import * as https from "https";
import type { Agent } from "http";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

interface CachedEntry {
  agent: Agent;
  proxyUrl: string;
}

export interface ProxyConfig {
  id: string;
  proxy_type: string | null;
  proxy_url: string | null;
  proxy_username: string | null;
  proxy_password: string | null;
}

export class ProxyAgentFactory {
  private readonly cache = new Map<string, CachedEntry>();

  // 全局 keep-alive agents，无代理的 provider 复用 TCP 连接
  private keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
  private keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });

  /** 无代理配置的 provider 获取 keep-alive agent，按 protocol 分池复用 */
  getKeepAliveAgent(url: string): Agent {
    return url.startsWith("https") ? this.keepAliveHttpsAgent : this.keepAliveHttpAgent;
  }

  getAgent(provider: ProxyConfig): Agent | undefined {
    if (!provider.proxy_type || !provider.proxy_url) {
      return undefined;
    }

    const fullUrl = this.buildProxyUrl(provider);
    const cached = this.cache.get(provider.id);
    if (cached && cached.proxyUrl === fullUrl) {
      return cached.agent;
    }

    if (cached) {
      cached.agent.destroy();
      this.cache.delete(provider.id);
    }

    const agent = this.createAgent(provider.proxy_type, fullUrl);
    this.cache.set(provider.id, { agent, proxyUrl: fullUrl });
    return agent;
  }

  invalidate(providerId: string): void {
    const cached = this.cache.get(providerId);
    if (cached) {
      cached.agent.destroy();
      this.cache.delete(providerId);
    }
  }

  invalidateAll(): void {
    for (const cached of this.cache.values()) {
      cached.agent.destroy();
    }
    this.cache.clear();
    this.destroyKeepAliveAgents();
  }

  /** 清理所有 agent（proxy + keep-alive），供 fastify 关闭时调用 */
  destroy(): void {
    this.invalidateAll();
  }

  /** 销毁 keep-alive agents 并重建，保持后续调用可用 */
  private destroyKeepAliveAgents(): void {
    this.keepAliveHttpAgent.destroy();
    this.keepAliveHttpsAgent.destroy();
    this.keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
    this.keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
  }

  private createAgent(proxyType: string, proxyUrl: string): Agent {
    if (proxyType === "socks5") {
      return new SocksProxyAgent(proxyUrl) as unknown as Agent;
    }
    return new HttpsProxyAgent(proxyUrl) as unknown as Agent;
  }

  private buildProxyUrl(provider: ProxyConfig): string {
    let url = provider.proxy_url!;
    const username = provider.proxy_username;
    const password = provider.proxy_password;

    if (username) {
      const parsed = new URL(url);
      parsed.username = username;
      if (password) parsed.password = password;
      url = parsed.toString();
    }
    return url;
  }
}
