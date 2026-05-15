import { ServiceContainer, SERVICE_KEYS } from "../../src/core/container.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "../../src/core/concurrency/index.js";
import { RequestTracker } from "../../src/core/monitor/index.js";
import { ProxyAgentFactory } from "../../src/proxy/transport/proxy-agent.js";
import { FormatRegistry } from "../../src/proxy/format/registry.js";
import { openaiAdapter } from "../../src/proxy/format/adapters/openai.js";

/**
 * 创建并注册测试用的 ServiceContainer（含所有必要服务）。
 * 消除 mapping-reason 集成测试文件中的重复 container 注册代码。
 */
export function createTestContainer(): ServiceContainer {
  const container = new ServiceContainer();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  const formatRegistry = new FormatRegistry();
  formatRegistry.registerAdapter(openaiAdapter);

  container.register("semaphoreManager", () => semaphoreManager);
  container.register("tracker", () => tracker);
  container.register(SERVICE_KEYS.formatRegistry, () => formatRegistry);
  container.register("matcher", () => undefined);
  container.register("usageWindowTracker", () => undefined);
  container.register("sessionTracker", () => undefined);
  container.register("adaptiveController", () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  container.register(
    SERVICE_KEYS.proxyAgentFactory,
    () => new ProxyAgentFactory(),
  );

  return container;
}
