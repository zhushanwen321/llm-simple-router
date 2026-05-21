import { PipelineAbort } from "./types.js";
import type { PipelineContext, HookPhase, PipelineHook } from "./types.js";

/** 核心 hook 的 priority 阈值：低于此值或 core=true 的 hook 异常直接传播 */
const CORE_HOOK_PRIORITY_THRESHOLD = 100;

export class ProxyPipeline {
  private hooksByPhase = new Map<HookPhase, PipelineHook[]>();

  /** 注册钩子（幂等：同名钩子重复注册会静默跳过） */
  register(hook: PipelineHook): void {
    const list = this.hooksByPhase.get(hook.phase) ?? [];
    if (list.some((h) => h.name === hook.name)) return;
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

  /** 触发指定阶段的所有钩子（含异常降级） */
  async emit(phase: HookPhase, ctx: PipelineContext): Promise<void> {
    const hooks = this.hooksByPhase.get(phase) ?? [];
    for (const hook of hooks) {
      try {
        await hook.execute(ctx);
      } catch (e: unknown) {
        if (e instanceof PipelineAbort) throw e;
        // 核心 hook (priority < 100 或 core === true) 异常直接传播
        if (hook.priority < CORE_HOOK_PRIORITY_THRESHOLD || hook.core === true) throw e;
        // 非核心 hook 异常降级：记录日志但继续执行后续 hook
        ctx.request.log.error(
          { err: e, hook: hook.name, phase },
          "Pipeline hook error (degraded)",
        );
      }
    }
  }
}

/** 全局 Pipeline 单例，由 registerBuiltinHooks() 注册所有内置 hook */
export const proxyPipeline = new ProxyPipeline();
