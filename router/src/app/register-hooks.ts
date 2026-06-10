import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { ServiceContainer } from "../core/container.js";
import { authMiddleware } from "../middleware/auth.js";
import { createProxyHandler } from "../proxy/handler/create-proxy-handler.js";
import { registerBuiltinHooks } from "../proxy/pipeline/register-hooks.js";
import { proxyPipeline } from "../proxy/pipeline/pipeline.js";
import { clearEnhancementConfigCache } from "../proxy/routing/enhancement-config.js";
import type { StateRegistry } from "../core/registry.js";
import { RetryRuleMatcher } from "../proxy/orchestration/retry-rules.js";
import { SemaphoreManager } from "../core/concurrency/index.js";
import { AdaptiveController } from "../core/concurrency/index.js";

export interface RegisterHooksResult {
  stateRegistry: StateRegistry;
}

export interface RegisterHooksDeps {
  matcher: RetryRuleMatcher;
  semaphoreManager: SemaphoreManager;
  adaptiveController: AdaptiveController;
}

/**
 * 注册 auth middleware、内置 hooks、proxy handlers，构建 StateRegistry。
 * 返回 stateRegistry 供 admin 路由使用。
 */
export function registerAppHooks(
  app: FastifyInstance,
  db: Database.Database,
  container: ServiceContainer,
  deps: RegisterHooksDeps,
): RegisterHooksResult {
  const { matcher, semaphoreManager, adaptiveController } = deps;

  app.register(authMiddleware, { db });

  // 注册内置 hooks 到 ProxyPipeline（供 emit 执行 + Admin API 查询）
  registerBuiltinHooks();

  // --- Proxy handlers (Phase 3 pipeline) ---
  const openaiHandler = createProxyHandler({
    apiType: "openai",
    paths: ["/v1/chat/completions", "/chat/completions"],
  });
  const anthropicHandler = createProxyHandler({
    apiType: "anthropic",
    paths: ["/v1/messages"],
  });
  const responsesHandler = createProxyHandler({
    apiType: "openai-responses",
    paths: ["/v1/responses", "/responses"],
  });
  app.register(openaiHandler, { db, container });
  app.register(anthropicHandler, { db, container });
  app.register(responsesHandler, { db, container });

  // StateRegistry — Admin 层通过此接口触发 proxy 层状态刷新
  const stateRegistry: StateRegistry = {
    refreshRetryRules: () => matcher.load(db),
    updateProviderConcurrency: (providerId, cfg) => semaphoreManager.updateConfig(providerId, cfg),
    removeProvider: (providerId) => semaphoreManager.remove(providerId),
    removeAllProviders: () => semaphoreManager.removeAll(),
    getProviderStatus: (providerId) => semaphoreManager.getStatus(providerId),
    syncAdaptiveProvider: (providerId, cfg) => adaptiveController.syncProvider(providerId, cfg),
    removeAdaptiveProvider: (providerId) => adaptiveController.remove(providerId),
    getAdaptiveStatus: (providerId) => adaptiveController.getStatus(providerId),
    reinitializeProviders: () => {
      adaptiveController.removeAll();
      // reinitializeProviders 的完整实现在 buildApp 层通过 initializeProviderState 完成
      // StateRegistry 只重置 adaptive 状态，实际的重新初始化由调用方负责
    },
    clearEnhancementCache: () => clearEnhancementConfigCache(),
    getPipelineHooks: () => proxyPipeline.getAllHooks(),
  };

  return { stateRegistry };
}
