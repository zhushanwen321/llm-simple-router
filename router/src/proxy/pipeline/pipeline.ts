import type { PipelineContext, HookPhase, PipelineHook } from "./types.js";

export class ProxyPipeline {
  private hooksByPhase = new Map<HookPhase, PipelineHook[]>();

  /** 注册钩子 */
  register(hook: PipelineHook): void {
    const list = this.hooksByPhase.get(hook.phase) ?? [];
    list.push(hook);
    list.sort((a, b) => a.priority - b.priority);
    this.hooksByPhase.set(hook.phase, list);
  }

  /** 获取某阶段的钩子链（调试/Admin API 用） */
  getHookChain(phase: HookPhase): ReadonlyArray<{ name: string; priority: number }> {
    return (this.hooksByPhase.get(phase) ?? []).map((h) => ({
      name: h.name,
      priority: h.priority,
    }));
  }

  /** 触发指定阶段的所有钩子 */
  async emit(phase: HookPhase, ctx: PipelineContext): Promise<void> {
    const hooks = this.hooksByPhase.get(phase) ?? [];
    for (const hook of hooks) {
      await hook.execute(ctx);
    }
  }
}
