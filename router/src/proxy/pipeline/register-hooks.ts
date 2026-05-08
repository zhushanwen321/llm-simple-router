/**
 * 启动时注册所有内置 PipelineHook 到 hookRegistry。
 *
 * 这些 hook 定义已就绪，但 ProxyPipeline 尚未完全接管请求处理。
 * 注册到 hookRegistry 后，Admin API 可以查询当前配置的 hook 链。
 */
import { hookRegistry } from "../pipeline/hook-registry.js";
import { enhancementPreprocessHook } from "../hooks/builtin/enhancement-preprocess.js";
import { allowedModelsHook } from "../hooks/builtin/allowed-models.js";
import { overflowRedirectHook } from "../hooks/builtin/overflow-redirect.js";
import { pluginRequestHook } from "../hooks/builtin/plugin-request.js";
import { providerPatchesHook } from "../hooks/builtin/provider-patches.js";
import { requestLoggingHook } from "../hooks/builtin/request-logging.js";
import { errorLoggingHook } from "../hooks/builtin/error-logging.js";

export function registerBuiltinHooks(): void {
  hookRegistry.register(enhancementPreprocessHook);
  hookRegistry.register(allowedModelsHook);
  hookRegistry.register(overflowRedirectHook);
  hookRegistry.register(pluginRequestHook);
  hookRegistry.register(providerPatchesHook);
  hookRegistry.register(requestLoggingHook);
  hookRegistry.register(errorLoggingHook);
}
