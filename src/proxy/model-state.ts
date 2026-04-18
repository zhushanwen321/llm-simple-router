const HOUR_MS = 3600_000;
// 会话记忆在 24 小时后过期（滑动窗口）
const TTL_HOURS = 24;
const TTL_MS = TTL_HOURS * HOUR_MS;

interface StateEntry {
  model: string;
  updatedAt: number;
}

export class ModelStateManager {
  private store = new Map<string | null, StateEntry>();

  set(routerKeyId: string | null, model: string): void {
    if (model === "default") {
      this.store.delete(routerKeyId);
      return;
    }
    this.store.set(routerKeyId, { model, updatedAt: Date.now() });
  }

  get(routerKeyId: string | null): string | null {
    const entry = this.store.get(routerKeyId);
    if (!entry) return null;
    if (Date.now() - entry.updatedAt > TTL_MS) {
      this.store.delete(routerKeyId);
      return null;
    }
    return entry.model;
  }
}

// singleton
export const modelState = new ModelStateManager();
