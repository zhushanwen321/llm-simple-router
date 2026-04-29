# Adaptive Concurrency Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-provider adaptive concurrency control that dynamically adjusts the semaphore limit based on observed success/failure patterns.

**Architecture:** New `AdaptiveConcurrencyController` manages per-provider state machines in memory. It observes request outcomes through a callback in `ProxyOrchestrator` (and `ProviderSwitchNeeded` catch) and dynamically adjusts the semaphore's `maxConcurrency` via `updateConfig()`. No changes to the semaphore itself.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Vue 3 + shadcn-vue

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/migrations/033_add_adaptive_concurrency.sql` | Create | DB migration |
| `src/db/providers.ts` | Modify: lines 5-29 | Provider interface + PROVIDER_FIELDS |
| `src/proxy/adaptive-controller.ts` | Create | AdaptiveConcurrencyController state machine |
| `src/proxy/orchestrator.ts` | Modify: lines 49-57, 59-104 | Add adaptive notification |
| `src/proxy/types.ts` | Read only | ProviderSwitchNeeded (lastResult has statusCode) |
| `src/index.ts` | Modify: lines 184-230 | Init adaptive controller, pass to deps |
| `src/admin/providers.ts` | Modify: lines 110-129, 239-251 | Schema + handler + new endpoint |
| `tests/adaptive-controller.test.ts` | Create | Unit tests for all state transitions |
| `frontend/src/types/mapping.ts` | Modify: lines 29-40 | Provider type |
| `frontend/src/api/client.ts` | Modify: lines 122-132 | ProviderPayload type |
| `frontend/src/views/Providers.vue` | Modify: lines 149-171, 283-302, 406-419 | Form UI + validation + payload |
| `frontend/src/components/monitor/ConcurrencyPanel.vue` | Modify: lines 13-16 | Show adaptive status |
| `frontend/src/types/monitor.ts` | Modify: lines 61-69 | Add adaptive fields |

---

## Task 1: DB Migration

**Files:**
- Create: `src/db/migrations/033_add_adaptive_concurrency.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 033_add_adaptive_concurrency.sql
ALTER TABLE providers ADD COLUMN adaptive_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN adaptive_min INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Commit**

```bash
git add src/db/migrations/033_add_adaptive_concurrency.sql
git commit -m "feat: add adaptive concurrency DB migration"
```

---

## Task 2: DB Layer — Provider Type + Fields

**Files:**
- Modify: `src/db/providers.ts` (Provider interface, PROVIDER_FIELDS, PROVIDER_CONCURRENCY_DEFAULTS)

- [ ] **Step 1: Add fields to Provider interface (after line 16 `max_queue_size`)**

```typescript
  adaptive_enabled: number;
  adaptive_min: number;
```

- [ ] **Step 2: Add fields to PROVIDER_FIELDS set (line 29)**

Add to the Set constructor:
```typescript
"adaptive_enabled", "adaptive_min",
```

- [ ] **Step 3: Run existing provider tests**

Run: `npx vitest run tests/providers.test.ts`

Expected: PASS (new fields have NOT NULL DEFAULT in migration)

- [ ] **Step 4: Commit**

```bash
git add src/db/providers.ts
git commit -m "feat: add adaptive fields to Provider type"
```

---

## Task 3: AdaptiveConcurrencyController — TDD

**Files:**
- Create: `tests/adaptive-controller.test.ts`
- Create: `src/proxy/adaptive-controller.ts`

This is the core state machine. Pure logic, no I/O.

- [ ] **Step 1: Write the test file**

```typescript
// tests/adaptive-controller.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdaptiveConcurrencyController } from "../src/proxy/adaptive-controller.js";

function createMockSemaphore() {
  return {
    updateConfig: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ active: 0, queued: 0 }),
    acquire: vi.fn(),
    release: vi.fn(),
    remove: vi.fn(),
    removeAll: vi.fn(),
  };
}

describe("AdaptiveConcurrencyController", () => {
  let ctrl: AdaptiveConcurrencyController;
  let sem: ReturnType<typeof createMockSemaphore>;

  beforeEach(() => {
    sem = createMockSemaphore();
    ctrl = new AdaptiveConcurrencyController(sem as any);
  });

  describe("init", () => {
    it("starts at adaptive_min", () => {
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(false);
      expect(sem.updateConfig).toHaveBeenCalledWith("p1", {
        maxConcurrency: 3, queueTimeoutMs: 5000, maxQueueSize: 10,
      });
    });
  });

  describe("success transitions", () => {
    beforeEach(() => {
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      sem.updateConfig.mockClear();
    });

    it("opens probe window after 3 consecutive successes", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
      // semaphore allows 3+1=4
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", {
        maxConcurrency: 4, queueTimeoutMs: 0, maxQueueSize: 0,
      });
    });

    it("increases limit after 3 more successes with probe active", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // open probe
      sem.updateConfig.mockClear();
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // confirm
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true); // continues probing
      // semaphore allows 4+1=5
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", {
        maxConcurrency: 5, queueTimeoutMs: 0, maxQueueSize: 0,
      });
    });

    it("does not exceed hard max", () => {
      ctrl.init("p1", { min: 3, max: 4 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      // 3 successes → probe → 3 more → confirm to 4 → 3 more → probe but capped
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      sem.updateConfig.mockClear();
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      // probe active but maxConcurrency stays at 4 (capped by hard max)
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", {
        maxConcurrency: 4, queueTimeoutMs: 0, maxQueueSize: 0,
      });
    });

    it("resets failure counter on success", () => {
      ctrl.onRequestComplete("p1", { success: false });
      ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(1);
    });
  });

  describe("429 handling", () => {
    beforeEach(() => {
      ctrl.init("p1", { min: 2, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 8;
      sem.updateConfig.mockClear();
    });

    it("halves limit on 429", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(false);
    });

    it("enters cooldown after 429", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it("does not adjust during cooldown", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4); // unchanged
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(3); // counted
    });

    it("respects hard min", () => {
      ctrl["entries"].get("p1")!.state.currentLimit = 3;
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(2);
    });
  });

  describe("non-429 failures", () => {
    beforeEach(() => {
      ctrl.init("p1", { min: 1, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 6;
      sem.updateConfig.mockClear();
    });

    it("decreases by 2 after 3 consecutive failures", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(false);
    });

    it("does not decrease on non-consecutive failures", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
    });

    it("respects hard min", () => {
      ctrl["entries"].get("p1")!.state.currentLimit = 2;
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });
  });

  describe("cooldown expiry", () => {
    it("resumes after cooldown", () => {
      vi.useFakeTimers();
      ctrl.init("p1", { min: 2, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 4;
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(2);
      vi.advanceTimersByTime(31_000);
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
      vi.useRealTimers();
    });
  });

  describe("remove / re-init", () => {
    it("cleans up on remove", () => {
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.remove("p1");
      expect(ctrl.getStatus("p1")).toBeUndefined();
    });

    it("re-inits from scratch", () => {
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 6;
      ctrl.remove("p1");
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
    });
  });

  describe("syncProvider", () => {
    it("initializes on enable", () => {
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, adaptive_min: 3, max_concurrency: 20,
        queue_timeout_ms: 5000, max_queue_size: 10,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
    });

    it("removes on disable", () => {
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.syncProvider("p1", {
        adaptive_enabled: 0, adaptive_min: 1, max_concurrency: 20,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      expect(ctrl.getStatus("p1")).toBeUndefined();
    });

    it("clamps current limit when bounds change", () => {
      ctrl.init("p1", { min: 3, max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 10;
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, adaptive_min: 3, max_concurrency: 5,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5); // clamped to new max
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adaptive-controller.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AdaptiveConcurrencyController**

```typescript
// src/proxy/adaptive-controller.ts
import type { ProviderSemaphoreManager } from "./semaphore.js";

export interface AdaptiveState {
  currentLimit: number;
  probeActive: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  cooldownUntil: number;
}

interface AdaptiveResult {
  success: boolean;
  statusCode?: number;
}

const SUCCESS_THRESHOLD = 3;
const FAILURE_THRESHOLD = 3;
const DECREASE_STEP = 2;
const COOLDOWN_MS = 30_000;

interface AdaptiveEntry {
  state: AdaptiveState;
  min: number;
  max: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export class AdaptiveConcurrencyController {
  private readonly entries = new Map<string, AdaptiveEntry>();

  constructor(private semaphoreManager: ProviderSemaphoreManager) {}

  init(providerId: string, config: { min: number; max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }): void {
    this.entries.set(providerId, {
      state: {
        currentLimit: config.min,
        probeActive: false,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
      },
      min: config.min,
      max: config.max,
      queueTimeoutMs: semParams.queueTimeoutMs,
      maxQueueSize: semParams.maxQueueSize,
    });
    this.syncToSemaphore(providerId);
  }

  remove(providerId: string): void {
    this.entries.delete(providerId);
  }

  onRequestComplete(providerId: string, result: AdaptiveResult): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    if (result.success) {
      this.transitionSuccess(providerId, entry);
    } else {
      this.transitionFailure(providerId, entry, result.statusCode);
    }
  }

  getStatus(providerId: string): AdaptiveState | undefined {
    return this.entries.get(providerId)?.state;
  }

  /** Admin API 调用：启用/禁用/参数变更时同步 */
  syncProvider(providerId: string, p: {
    adaptive_enabled: number; adaptive_min: number; max_concurrency: number;
    queue_timeout_ms: number; max_queue_size: number;
  }): void {
    if (p.adaptive_enabled) {
      const existing = this.entries.get(providerId);
      if (existing) {
        existing.min = p.adaptive_min;
        existing.max = p.max_concurrency;
        existing.queueTimeoutMs = p.queue_timeout_ms;
        existing.maxQueueSize = p.max_queue_size;
        existing.state.currentLimit = Math.min(
          Math.max(existing.state.currentLimit, existing.min), existing.max,
        );
        this.syncToSemaphore(providerId);
      } else {
        this.init(providerId, { min: p.adaptive_min, max: p.max_concurrency }, {
          queueTimeoutMs: p.queue_timeout_ms, maxQueueSize: p.max_queue_size,
        });
      }
    } else {
      this.remove(providerId);
    }
  }

  private transitionSuccess(providerId: string, entry: AdaptiveEntry): void {
    const s = entry.state;
    s.consecutiveSuccesses++;
    s.consecutiveFailures = 0;
    if (Date.now() < s.cooldownUntil) return;

    if (s.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
      if (!s.probeActive) {
        s.probeActive = true;
        s.consecutiveSuccesses = 0;
      } else {
        s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
        s.consecutiveSuccesses = 0;
      }
      this.syncToSemaphore(providerId);
    }
  }

  private transitionFailure(providerId: string, entry: AdaptiveEntry, statusCode?: number): void {
    const s = entry.state;
    s.consecutiveFailures++;
    s.consecutiveSuccesses = 0;

    if (statusCode === 429) {
      s.currentLimit = Math.max(Math.floor(s.currentLimit / 2), entry.min);
      s.probeActive = false;
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
    } else if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      s.currentLimit = Math.max(s.currentLimit - DECREASE_STEP, entry.min);
      s.probeActive = false;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
    }
  }

  private syncToSemaphore(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    this.semaphoreManager.updateConfig(providerId, {
      maxConcurrency: entry.state.currentLimit + (entry.state.probeActive ? 1 : 0),
      queueTimeoutMs: entry.queueTimeoutMs,
      maxQueueSize: entry.maxQueueSize,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adaptive-controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/adaptive-controller.ts tests/adaptive-controller.test.ts
git commit -m "feat: add AdaptiveConcurrencyController with state machine and tests"
```

---

## Task 4: Admin API Backend

**Files:**
- Modify: `src/admin/providers.ts`

Depends on: Task 3 (imports AdaptiveConcurrencyController)

- [ ] **Step 1: Add import at top of file**

```typescript
import { AdaptiveConcurrencyController } from "../proxy/adaptive-controller.js";
```

- [ ] **Step 2: Update options interface (around line 125-129)**

Add `adaptiveController` to the interface:

```typescript
interface ProviderRoutesOptions {
  db: Database.Database;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  semaphoreManager?: ProviderSemaphoreManager;
  adaptiveController?: AdaptiveConcurrencyController;
}
```

- [ ] **Step 3: Add adaptive fields to validation schema (around line 110-123)**

Add to the zod body schema:

```typescript
adaptive_enabled: z.number().int().min(0).max(1).optional(),
adaptive_min: z.number().int().min(1).optional(),
```

- [ ] **Step 4: Update PUT handler — add adaptive sync (after line 245 semaphore updateConfig block)**

```typescript
// Adaptive controller sync
if (body.adaptive_enabled !== undefined || body.adaptive_min !== undefined || body.max_concurrency !== undefined) {
  adaptiveController?.syncProvider(id, {
    adaptive_enabled: updated.adaptive_enabled,
    adaptive_min: updated.adaptive_min,
    max_concurrency: updated.max_concurrency,
    queue_timeout_ms: updated.queue_timeout_ms,
    max_queue_size: updated.max_queue_size,
  });
}
```

- [ ] **Step 5: Add adaptive-status endpoint (after existing routes)**

```typescript
app.get("/admin/api/providers/:id/adaptive-status", async (request, reply) => {
  const { id } = request.params as { id: string };
  const status = adaptiveController?.getStatus(id);
  if (!status) return reply.code(404).send({ error: "Not found or adaptive not enabled" });
  return status;
});
```

- [ ] **Step 6: Run admin tests**

Run: `npx vitest run tests/admin-providers.test.ts`
Expected: PASS (new fields are optional with defaults)

- [ ] **Step 7: Commit**

```bash
git add src/admin/providers.ts
git commit -m "feat: add adaptive concurrency admin API and status endpoint"
```

---

## Task 5: Orchestrator Integration

**Files:**
- Modify: `src/proxy/orchestrator.ts` (createOrchestrator, constructor, handle)
- Modify: `src/index.ts` (init, pass to deps)

Depends on: Task 3

- [ ] **Step 1: Update orchestrator.ts — add import**

```typescript
import type { AdaptiveConcurrencyController } from "./adaptive-controller.js";
```

- [ ] **Step 2: Update createOrchestrator (line 49-57)**

Add `adaptiveController` parameter:

```typescript
export function createOrchestrator(
  semaphoreManager?: ProviderSemaphoreManager,
  tracker?: RequestTracker,
  adaptiveController?: AdaptiveConcurrencyController,
): ProxyOrchestrator | undefined {
  const semaphoreScope = semaphoreManager ? new SemaphoreScopeClass(semaphoreManager) : undefined;
  const trackerScope = tracker ? new TrackerScopeClass(tracker) : undefined;
  if (!semaphoreScope || !trackerScope) return undefined;
  return new ProxyOrchestrator({
    semaphoreScope, trackerScope, resilience: new ResilienceLayerClass(),
    adaptiveController,
  });
}
```

- [ ] **Step 3: Update constructor deps type**

```typescript
constructor(
  private deps: {
    semaphoreScope: SemaphoreScope;
    trackerScope: TrackerScope;
    resilience: ResilienceLayer;
    adaptiveController?: AdaptiveConcurrencyController;
  },
) {}
```

- [ ] **Step 4: Update handle() — wrap with try/catch for adaptive notification**

Replace lines 76-103 with:

```typescript
    const trackerReq = this.buildActiveRequest(request, config, apiType);
    try {
      const result = await this.deps.trackerScope.track<ResilienceResult>(
        trackerReq,
        () => this.deps.semaphoreScope.withSlot(
          config.provider.id,
          this.createAbortSignal(request),
          () => {
            trackerReq.queued = true;
            this.deps.trackerScope.markQueued(trackerReq.id, true);
          },
          () => {
            if (trackerReq.queued) {
              trackerReq.queued = false;
              this.deps.trackerScope.markQueued(trackerReq.id, false);
            }
            return this.executeResilience(config, ctx);
          },
          config.concurrencyOverride,
        ),
        (result) => this.extractTrackStatus(result),
        (result) => result.attempts.map(a => ({
          statusCode: a.statusCode,
          error: a.error,
          latencyMs: a.latencyMs,
          providerId: a.target.provider_id,
        })),
      );
      // Adaptive notification — normal completion
      if (this.deps.adaptiveController) {
        const ts = this.extractTrackStatus(result);
        this.deps.adaptiveController.onRequestComplete(config.provider.id, {
          success: ts.status === "completed",
          statusCode: ts.statusCode,
        });
      }
      this.sendResponse(reply, result.result, ctx);
      return result;
    } catch (e) {
      // Adaptive notification — ProviderSwitchNeeded
      if (e instanceof ProviderSwitchNeeded && this.deps.adaptiveController) {
        const lr = e.lastResult;
        this.deps.adaptiveController.onRequestComplete(config.provider.id, {
          success: false,
          statusCode: "statusCode" in lr ? (lr as { statusCode: number }).statusCode : undefined,
        });
      }
      throw e;
    }
```

Note: Add `import { ProviderSwitchNeeded } from "./types.js";` at the top if not already imported.

- [ ] **Step 5: Update src/index.ts — create and wire controller**

After line 186 (`tracker.startPushInterval()`), add:

```typescript
const adaptiveController = new AdaptiveConcurrencyController(semaphoreManager);
```

Update provider init loop (lines 193-208):

```typescript
const allProviders = getAllProviders(db);
for (const p of allProviders) {
  if (p.adaptive_enabled) {
    adaptiveController.init(p.id, { min: p.adaptive_min, max: p.max_concurrency }, {
      queueTimeoutMs: p.queue_timeout_ms, maxQueueSize: p.max_queue_size,
    });
  } else if (p.max_concurrency > 0) {
    semaphoreManager.updateConfig(p.id, {
      maxConcurrency: p.max_concurrency,
      queueTimeoutMs: p.queue_timeout_ms,
      maxQueueSize: p.max_queue_size,
    });
  }
  tracker.updateProviderConfig(p.id, { ... }); // existing tracker update unchanged
}
```

Update `createOrchestrator` calls — add `adaptiveController` as 3rd arg.

Update `adminRoutes` registration — add `adaptiveController` to options.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run tests/`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/proxy/orchestrator.ts src/index.ts
git commit -m "feat: integrate adaptive controller into orchestrator and init"
```

---

## Task 6: Frontend Provider Form

**Files:**
- Modify: `frontend/src/types/mapping.ts` (Provider type)
- Modify: `frontend/src/api/client.ts` (ProviderPayload type)
- Modify: `frontend/src/views/Providers.vue` (form UI + validation + payload)

- [ ] **Step 1: Update Provider type in mapping.ts (lines 29-40)**

Add after `max_queue_size`:
```typescript
  adaptive_enabled: number
  adaptive_min: number
```

- [ ] **Step 2: Update ProviderPayload in client.ts (lines 122-132)**

Add optional fields:
```typescript
  adaptive_enabled?: number
  adaptive_min?: number
```

- [ ] **Step 3: Update Providers.vue — form ref**

Add to the form ref object:
```typescript
adaptive_enabled: false,
adaptive_min: 1,
```

- [ ] **Step 4: Update Providers.vue — add adaptive UI after concurrency section (after line 171)**

After the closing `</div>` of the concurrency fields block:

```html
<!-- 自适应并发 (仅并发控制启用时显示) -->
<div v-if="concurrencyEnabled" class="mt-3 border-t pt-3">
  <div class="flex items-center gap-2 mb-1">
    <Switch v-model="form.adaptive_enabled" id="adaptive-switch" />
    <Label for="adaptive-switch" class="text-sm text-foreground">自适应并发</Label>
  </div>
  <p v-if="form.adaptive_enabled" class="text-xs text-muted-foreground mb-2">
    从 {{ form.adaptive_min || 1 }} 开始自动调整，上限为 {{ form.max_concurrency || '-' }}
  </p>
  <div v-if="form.adaptive_enabled" class="space-y-2">
    <div>
      <Label class="block text-sm font-medium text-foreground mb-1">自适应下限</Label>
      <Input v-model.number="form.adaptive_min" type="number" min="1" :max="form.max_concurrency || 100" placeholder="1" @input="delete errors.adaptive_min" />
      <p v-if="errors.adaptive_min" class="text-sm text-destructive mt-1">{{ errors.adaptive_min }}</p>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Update Providers.vue — max_concurrency label**

Change line with "最大并发数" to:

```html
<Label class="block text-sm font-medium text-foreground mb-1">
  {{ form.adaptive_enabled ? '自适应上限' : '最大并发数' }}
</Label>
```

- [ ] **Step 6: Update Providers.vue — validate() (around line 283-302)**

Add after the concurrency validation block:

```typescript
if (concurrencyEnabled.value && form.value.adaptive_enabled) {
  const min = form.value.adaptive_min;
  if (!min || min < 1) errs.adaptive_min = '最小为 1';
  if (min > form.value.max_concurrency) errs.adaptive_min = '不能超过上限 ' + form.value.max_concurrency;
}
```

- [ ] **Step 7: Update Providers.vue — buildPayload() (around line 406-419)**

Add to the payload object:

```typescript
adaptive_enabled: concurrencyEnabled.value && form.value.adaptive_enabled ? 1 : 0,
adaptive_min: concurrencyEnabled.value && form.value.adaptive_enabled ? form.value.adaptive_min : 1,
```

- [ ] **Step 8: Update Providers.vue — resetForm()**

Add adaptive fields to the reset state:
```typescript
adaptive_enabled: false,
adaptive_min: 1,
```

- [ ] **Step 9: Update Providers.vue — table concurrency cell (lines 50-53)**

Replace with:

```html
<TableCell>
  <Badge v-if="p.adaptive_enabled" variant="outline">自适应</Badge>
  <Badge v-else-if="p.max_concurrency > 0" variant="secondary">{{ p.max_concurrency }}</Badge>
  <span v-else class="text-muted-foreground">-</span>
</TableCell>
```

- [ ] **Step 10: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: SUCCESS

- [ ] **Step 11: Commit**

```bash
git add frontend/src/types/mapping.ts frontend/src/api/client.ts frontend/src/views/Providers.vue
git commit -m "feat: add adaptive concurrency UI in provider form"
```

---

## Task 7: Frontend Monitor Display

**Files:**
- Modify: `frontend/src/types/monitor.ts`
- Modify: `frontend/src/components/monitor/ConcurrencyPanel.vue`

- [ ] **Step 1: Update ProviderConcurrencySnapshot in monitor.ts (lines 61-69)**

Add optional adaptive fields:

```typescript
adaptiveEnabled?: boolean
adaptiveLimit?: number
adaptiveProbeActive?: boolean
```

- [ ] **Step 2: Update ConcurrencyPanel.vue — status text (around line 13-16)**

Replace the active/max display:

```html
<span class="text-muted-foreground">
  <template v-if="provider.adaptiveEnabled">
    {{ provider.active }} / {{ provider.adaptiveLimit ?? provider.maxConcurrency }}
    <span class="text-xs">(自适应)</span>
  </template>
  <template v-else-if="provider.maxConcurrency === 0">未限制</template>
  <template v-else>{{ provider.active }} / {{ provider.maxConcurrency }}</template>
</span>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/monitor.ts frontend/src/components/monitor/ConcurrencyPanel.vue
git commit -m "feat: show adaptive concurrency status in monitor"
```
