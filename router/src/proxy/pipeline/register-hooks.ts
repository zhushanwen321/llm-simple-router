/**
 * 启动时注册所有内置 PipelineHook 到 proxyPipeline。
 */
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
import { routeResolveHook } from "../hooks/builtin/route-resolve.js";
import { formatTransformHook } from "../hooks/builtin/format-transform.js";
import { apiKeyDecryptHook } from "../hooks/builtin/api-key-decrypt.js";
import { transportExecuteHook } from "../hooks/builtin/transport-execute.js";
import { streamTimeoutHook } from "../hooks/builtin/stream-timeout.js";
import { usageRecordHook } from "../hooks/builtin/usage-record.js";

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
  routeResolveHook,
  formatTransformHook,
  apiKeyDecryptHook,
  transportExecuteHook,
  streamTimeoutHook,
  usageRecordHook,
];

export function registerBuiltinHooks(): void {
  for (const hook of ALL_HOOKS) {
    proxyPipeline.register(hook);
  }
}
