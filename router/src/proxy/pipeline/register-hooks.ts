/**
 * 启动时注册所有内置 PipelineHook。
 *
 * 旧 hookRegistry 仅用于 Admin API 查询（不执行），
 * ProxyPipeline 单例用于实际请求处理中的 emit 调用。
 */
import { hookRegistry } from "../pipeline/hook-registry.js";
import { proxyPipeline } from "../pipeline/pipeline.js";
import { enhancementPreprocessHook } from "../hooks/builtin/enhancement-preprocess.js";
import { allowedModelsHook } from "../hooks/builtin/allowed-models.js";
import { overflowRedirectHook } from "../hooks/builtin/overflow-redirect.js";
import { pluginRequestHook } from "../hooks/builtin/plugin-request.js";
import { providerPatchesHook } from "../hooks/builtin/provider-patches.js";
import { requestLoggingHook } from "../hooks/builtin/request-logging.js";
import { errorLoggingHook } from "../hooks/builtin/error-logging.js";
import { clientDetectionHook } from "../hooks/builtin/client-detection.js";
import { cacheEstimationHook } from "../hooks/builtin/cache-estimation.js";

const ALL_HOOKS = [
  enhancementPreprocessHook,
  allowedModelsHook,
  overflowRedirectHook,
  pluginRequestHook,
  providerPatchesHook,
  requestLoggingHook,
  errorLoggingHook,
  clientDetectionHook,
  cacheEstimationHook,
];

export function registerBuiltinHooks(): void {
  for (const hook of ALL_HOOKS) {
    hookRegistry.register(hook);
    proxyPipeline.register(hook);
  }
}
