/**
 * pre_transport hook: 薄委托层，实际逻辑在 transport-execute-impl.ts
 */
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { executeTransportHook } from "./transport-execute-impl.js";

export const transportExecuteHook: PipelineHook = {
  name: "builtin:transport-execute",
  phase: "pre_transport",
  priority: 300,
  core: true,

  async execute(ctx: PipelineContext): Promise<void> {
    await executeTransportHook(ctx);
  },
};
