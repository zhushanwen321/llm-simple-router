/**
 * post_route hook: 溢出重定向。
 *
 * 路由解析完成后，检查请求 token 是否超出当前模型上下文窗口。
 * 超出时切换到配置的溢出目标模型/provider。
 *
 * 修改 ctx.resolved、ctx.body.model。
 *
 * 依赖：ctx.metadata 中需设置 "db"
 */
import Database from "better-sqlite3";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { getProviderById } from "../../../db/index.js";
import { applyOverflowRedirect } from "../../routing/overflow.js";

export const overflowRedirectHook: PipelineHook = {
  name: "builtin:overflow-redirect",
  phase: "post_route",
  priority: 100,
  execute(ctx: PipelineContext): void {
    const { resolved, body } = ctx;
    if (!resolved) return;

    const db = ctx.metadata.get("db") as Database.Database;
    if (!db) return;

    const overflowResult = applyOverflowRedirect(resolved, db, body);
    if (!overflowResult) {
      ctx.snapshot.add({ stage: "overflow", triggered: false });
      return;
    }

    const overflowProvider = getProviderById(db, overflowResult.provider_id);
    if (overflowProvider && overflowProvider.is_active) {
      ctx.resolved = {
        ...resolved,
        provider_id: overflowResult.provider_id,
        backend_model: overflowResult.backend_model,
      };
      ctx.provider = overflowProvider as unknown as import("../../pipeline/types.js").ProviderInfo;
      body.model = overflowResult.backend_model;
      ctx.snapshot.add({
        stage: "overflow",
        triggered: true,
        redirect_to: overflowResult.backend_model,
        redirect_provider: overflowResult.provider_id,
      });
    } else {
      ctx.snapshot.add({ stage: "overflow", triggered: false });
    }
  },
};
