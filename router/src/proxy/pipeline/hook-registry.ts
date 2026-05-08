/**
 * Hook 注册表 — 全局单例，收集所有 PipelineHook 供 Admin API 查询。
 *
 * Pipeline 目前尚未完全接管请求处理（failover-loop.ts 仍为内联逻辑），
 * 但内置 hook 定义已经存在。此注册表在启动时一次性注册所有已知 hook，
 * Admin API 通过它暴露当前 hook 配置。
 */
import type { HookPhase, PipelineHook } from "./types.js";

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

class HookRegistry {
  private allHooks: PipelineHook[] = [];

  register(hook: PipelineHook): void {
    this.allHooks.push(hook);
  }

  getByPhase(phase: HookPhase): HookSummary[] {
    return this.allHooks
      .filter(h => h.phase === phase)
      .sort((a, b) => a.priority - b.priority)
      .map(h => ({ name: h.name, priority: h.priority }));
  }

  getAll(): Record<string, HookSummary[]> {
    return Object.fromEntries(ALL_PHASES.map(phase => [phase, this.getByPhase(phase)]));
  }
}

export const hookRegistry = new HookRegistry();
