import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { SERVICE_KEYS } from "../../../core/container.js";
import type { ServiceContainer } from "../../../core/container.js";
import type { UsageWindowTracker } from "../../routing/usage-window-tracker.js";

/** post_response: 成功/流式请求完成后记录用量窗口 */
export const usageRecordHook: PipelineHook = {
  name: "builtin:usage-record",
  phase: "post_response",
  priority: 120,
  execute(ctx: PipelineContext): void {
    const container = ctx.metadata.get("container") as ServiceContainer;
    const usageWindowTracker = container.resolve<UsageWindowTracker>(
      SERVICE_KEYS.usageWindowTracker,
    );
    if (!usageWindowTracker) return;

    const result = ctx.resilienceResult?.result;
    if (!result) return;

    const succeeded =
      result.kind === "success" ||
      result.kind === "stream_success" ||
      result.kind === "stream_abort";
    if (!succeeded) return;

    const provider = ctx.provider!;
    const routerKeyId =
      (
        ctx.request.routerKey as
          | { id?: string }
          | undefined
      )?.id ?? undefined;
    usageWindowTracker.recordRequest(provider.id, routerKeyId);
  },
};
