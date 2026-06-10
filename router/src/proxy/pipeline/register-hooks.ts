/**
 * 启动时注册所有内置 PipelineHook。
 *
 * ProxyPipeline 单例同时用于实际请求处理（emit）和 Admin API 查询（getAllHooks）。
 */
import { proxyPipeline } from "./pipeline.js";
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
    proxyPipeline.register(hook);
  }
}
