const TTL_MS = 24 * 60 * 60 * 1000;

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
