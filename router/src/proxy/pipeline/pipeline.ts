import type { PipelineContext, HookPhase, PipelineHook } from "./types.js";

const ALL_PHASES: HookPhase[] = [
  "pre_route",
  "post_route",
  "pre_transport",
  "post_response",
  "on_error",
  "on_stream_event",
];

export interface HookSummary {
  name: string;
  priority: number;
}

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

  /** 获取某阶段的 hook 摘要（Admin API 用） */
  getByPhase(phase: HookPhase): HookSummary[] {
    return (this.hooksByPhase.get(phase) ?? []).map((h) => ({
      name: h.name,
      priority: h.priority,
    }));
  }

  /** 获取所有阶段的 hook 摘要（Admin API 用） */
  getAllHooks(): Record<string, HookSummary[]> {
    return Object.fromEntries(
      ALL_PHASES.map((phase) => [phase, this.getByPhase(phase)]),
    );
  }

  /** 触发指定阶段的所有钩子 */
  async emit(phase: HookPhase, ctx: PipelineContext): Promise<void> {
    const hooks = this.hooksByPhase.get(phase) ?? [];
    for (const hook of hooks) {
      if (hook.core === true) {
        await hook.execute(ctx);
      } else {
        try {
          await hook.execute(ctx);
        } catch (err: unknown) {
          ctx.request.log.warn({ hook: hook.name, err }, "non-core hook error");
        }
      }
    }
  }
}

/** 全局 Pipeline 单例，由 registerBuiltinHooks() 注册所有内置 hook */
export const proxyPipeline = new ProxyPipeline();
