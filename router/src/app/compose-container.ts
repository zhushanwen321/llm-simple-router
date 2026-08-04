import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { ServiceContainer, SERVICE_KEYS } from "../core/container.js";
import { RetryRuleMatcher } from "../proxy/orchestration/retry-rules.js";
import { PluginRegistry } from "../proxy/transform/plugin-registry.js";
import { FormatRegistry } from "../proxy/format/registry.js";
import { openaiAdapter } from "../proxy/format/adapters/openai.js";
import { anthropicAdapter } from "../proxy/format/adapters/anthropic.js";
import { responsesAdapter } from "../proxy/format/adapters/responses.js";
import { openaiToAnthropicConverter } from "../proxy/format/converters/openai-anthropic.js";
import { anthropicToOpenAIConverter } from "../proxy/format/converters/anthropic-openai.js";
import { openaiToResponsesConverter } from "../proxy/format/converters/openai-responses.js";
import { responsesToOpenAIConverter } from "../proxy/format/converters/responses-openai.js";
import { responsesToAnthropicConverter } from "../proxy/format/converters/responses-anthropic.js";
import { anthropicToResponsesConverter } from "../proxy/format/converters/anthropic-responses.js";
import { SemaphoreManager, AdaptiveController } from "../core/concurrency/index.js";
import { RequestTracker } from "../core/monitor/index.js";
import { UsageWindowTracker } from "../proxy/routing/usage-window-tracker.js";
import { SessionTracker, DEFAULT_LOOP_PREVENTION_CONFIG } from "../core/loop-prevention/index.js";
import { LogFileWriter } from "../storage/log-file-writer.js";
import { ProxyAgentFactory } from "../proxy/transport/proxy-agent.js";
import { CircuitBreaker } from "../proxy/routing/circuit-breaker.js";
import { getDetailLogEnabled } from "../db/settings.js";
import type { Config } from "../config/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ComposeContainerResult {
  container: ServiceContainer;
  logFileWriter: LogFileWriter | null;
  logsDir: string;
  isMemoryDb: boolean;
}

export interface ComposeContainerOptions {
  config: Config;
}

/**
 * 注册所有服务到 ServiceContainer。
 * 返回 container 及 logFileWriter（close 时需要 flush）。
 */
export function composeContainer(
  db: Database.Database,
  opts: ComposeContainerOptions,
  app: FastifyInstance,
): ComposeContainerResult {
  const { config } = opts;
  const container = new ServiceContainer();

  container.register(SERVICE_KEYS.db, () => db);
  container.register(SERVICE_KEYS.matcher, (c) => {
    const m = new RetryRuleMatcher();
    m.load(c.resolve(SERVICE_KEYS.db));
    return m;
  });
  container.register(SERVICE_KEYS.semaphoreManager, () => new SemaphoreManager());
  container.register(SERVICE_KEYS.tracker, (c) => {
    const t = new RequestTracker({ semaphoreManager: c.resolve(SERVICE_KEYS.semaphoreManager), logger: app.log });
    t.startPushInterval();
    return t;
  });
  container.register(SERVICE_KEYS.usageWindowTracker, (c) => {
    const uwt = new UsageWindowTracker(c.resolve(SERVICE_KEYS.db));
    uwt.reconcileOnStartup();
    return uwt;
  });
  container.register(SERVICE_KEYS.sessionTracker, () => new SessionTracker(DEFAULT_LOOP_PREVENTION_CONFIG.sessionTracker));

  // 文件日志写入器
  const isMemoryDb = config.DB_PATH === ":memory:";
  const logsDir = isMemoryDb ? "" : join(dirname(config.DB_PATH), "logs");
  const logFileWriter = isMemoryDb
    ? null
    : new LogFileWriter(logsDir, { enabled: getDetailLogEnabled(db) });
  container.register(SERVICE_KEYS.logFileWriter, () => logFileWriter);

  // AdaptiveController（依赖已注册的 semaphoreManager）
  container.register(SERVICE_KEYS.adaptiveController, (c) => {
    const ac = new AdaptiveController(c.resolve(SERVICE_KEYS.semaphoreManager), app.log);
    return ac;
  });

  // PluginRegistry
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.loadFromDB(db);
  const pluginsDir = path.resolve(__dirname, "../../plugins/transform");
  pluginRegistry.scanPluginsDir(pluginsDir);
  container.register(SERVICE_KEYS.pluginRegistry, () => pluginRegistry);

  // FormatRegistry（3 adapters + 6 converters）
  const formatRegistry = new FormatRegistry();
  formatRegistry.registerAdapter(openaiAdapter);
  formatRegistry.registerAdapter(anthropicAdapter);
  formatRegistry.registerAdapter(responsesAdapter);
  formatRegistry.registerConverter(openaiToAnthropicConverter);
  formatRegistry.registerConverter(anthropicToOpenAIConverter);
  formatRegistry.registerConverter(openaiToResponsesConverter);
  formatRegistry.registerConverter(responsesToOpenAIConverter);
  formatRegistry.registerConverter(responsesToAnthropicConverter);
  formatRegistry.registerConverter(anthropicToResponsesConverter);
  container.register(SERVICE_KEYS.formatRegistry, () => formatRegistry);

  // ProxyAgentFactory
  container.register(SERVICE_KEYS.proxyAgentFactory, () => new ProxyAgentFactory());

  // CircuitBreaker（全局熔断状态机，无依赖内存单例）
  container.register(SERVICE_KEYS.circuitBreaker, () => new CircuitBreaker());

  return { container, logFileWriter, logsDir, isMemoryDb };
}
