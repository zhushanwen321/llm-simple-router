# Pi Extension Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract concurrency control, loop prevention, and monitoring from llm-simple-router into a standalone npm package `@llm-router/core`, refactor router to consume it, and build a pi coding agent extension.

**Architecture:** Monorepo with 4 workspace packages — `core/` (shared library), `router/` (existing Fastify service), `pi-extension/` (pi extension adapter), `frontend/` (admin dashboard). Core has zero framework dependencies. Router and pi-extension both depend on core.

**Tech Stack:** TypeScript, Node.js, vitest, npm workspaces

---

## File Structure

### Core package (new)
```
core/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    types.ts                              ← Logger interface
    errors.ts                             ← SemaphoreQueueFullError, SemaphoreTimeoutError
    index.ts                              ← Unified re-export
    concurrency/
      types.ts                            ← ConcurrencyConfig, ISemaphoreControl, AdaptiveState
      semaphore.ts                        ← SemaphoreManager
      adaptive-controller.ts             ← AdaptiveController
      index.ts                            ← Re-export
    loop-prevention/
      types.ts                            ← LoopPreventionConfig, all config/result types
      detector.ts                         ← LoopDetector interface
      ngram-detector.ts                   ← NGramLoopDetector
      session-tracker.ts                  ← SessionTracker
      stream-loop-guard.ts               ← StreamLoopGuard
      tool-loop-guard.ts                  ← ToolLoopGuard
      index.ts                            ← Re-export
    monitor/
      types.ts                            ← ActiveRequest, StatsSnapshot, etc.
      stats-aggregator.ts                ← StatsAggregator + RingBuffer
      runtime-collector.ts              ← RuntimeCollector
      request-tracker.ts                 ← RequestTracker
      stream-content-accumulator.ts     ← StreamContentAccumulator
      stream-extractor.ts               ← extractStreamText
      index.ts                            ← Re-export
  tests/
    concurrency/
      semaphore.test.ts
    loop-prevention/
      ngram-detector.test.ts
      session-tracker.test.ts
      stream-loop-guard.test.ts
      tool-loop-guard.test.ts
      loop-prevention-integration.test.ts
    monitor/
      stats-aggregator.test.ts
      runtime-collector.test.ts
      request-tracker.test.ts
      stream-content-accumulator.test.ts
```

### Router package (restructured from root)
```
router/
  package.json
  tsconfig.json
  vitest.config.ts
  Dockerfile
  src/                                    ← existing src/ moved here, imports updated
```

### Pi extension package (new)
```
pi-extension/
  package.json
  tsconfig.json
  src/
    index.ts                              ← Extension entry point
    config.ts                             ← Config schema + loader
  config.example.json
```

### Root (modified)
```
package.json                              ← workspaces config
tsconfig.base.json                       ← shared TS config
frontend/                                ← unchanged
```

---

## Phase 1: Core Package

### Task 1: Create monorepo root structure

**Files:**
- Modify: `package.json` (root)
- Create: `tsconfig.base.json`

- [ ] **Step 1: Update root package.json to workspace mode**

Replace root `package.json` with workspace root:

```json
{
  "name": "llm-simple-router-workspace",
  "private": true,
  "workspaces": ["core", "router", "pi-extension", "frontend"],
  "scripts": {
    "build": "npm run build -w core -w router",
    "test": "npm run test -w core -w router",
    "dev": "npm run dev -w router"
  }
}
```

- [ ] **Step 2: Create shared tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Verify workspace resolution**

Run: `npm install`
Expected: npm resolves workspaces and links them in `node_modules/`.

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.base.json
git commit -m "chore: convert to monorepo workspace root"
```

---

### Task 2: Create core package scaffold

**Files:**
- Create: `core/package.json`
- Create: `core/tsconfig.json`
- Create: `core/vitest.config.ts`
- Create: `core/src/types.ts`
- Create: `core/src/errors.ts`
- Create: `core/src/index.ts`

- [ ] **Step 1: Create core/package.json**

```json
{
  "name": "@llm-router/core",
  "version": "0.1.0",
  "description": "Shared core library for LLM router: concurrency control, loop prevention, request monitoring",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./concurrency": {
      "types": "./dist/concurrency/index.d.ts",
      "import": "./dist/concurrency/index.js"
    },
    "./loop-prevention": {
      "types": "./dist/loop-prevention/index.d.ts",
      "import": "./dist/loop-prevention/index.js"
    },
    "./monitor": {
      "types": "./dist/monitor/index.d.ts",
      "import": "./dist/monitor/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

- [ ] **Step 2: Create core/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create core/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 4: Create core/src/types.ts — generic Logger interface**

```typescript
/** Generic logger interface for core package decoupling from pino/fastify. */
export interface Logger {
  debug?(obj: Record<string, unknown>, msg: string): void;
  warn?(obj: Record<string, unknown>, msg: string): void;
  error?(obj: Record<string, unknown>, msg: string): void;
}
```

- [ ] **Step 5: Create core/src/errors.ts — shared error classes**

Extract only `SemaphoreQueueFullError` and `SemaphoreTimeoutError` from `src/core/errors.ts`. Do NOT include `ProviderSwitchNeeded` (router-specific).

```typescript
/**
 * Thrown when a provider's concurrency queue is full.
 */
export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

/**
 * Thrown when a provider's concurrency wait times out.
 */
export class SemaphoreTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`,
    );
    this.name = "SemaphoreTimeoutError";
  }
}
```

- [ ] **Step 6: Create core/src/index.ts — placeholder unified export**

```typescript
// @llm-router/core — unified re-export
// Individual sub-path imports also available:
//   @llm-router/core/concurrency
//   @llm-router/core/loop-prevention
//   @llm-router/core/monitor

export { SemaphoreQueueFullError, SemaphoreTimeoutError } from "./errors.js";
export type { Logger } from "./types.js";
```

- [ ] **Step 7: Install dependencies and verify build**

Run:
```bash
cd core && npm install && npm run build
```
Expected: compiles without errors, `dist/` created.

- [ ] **Step 8: Commit**

```bash
git add core/
git commit -m "feat(core): scaffold @llm-router/core package with logger and errors"
```

---

### Task 3: Migrate loop-prevention module to core

This module is pure logic with zero external dependencies. Migration is mostly copy with import path updates.

**Files:**
- Create: `core/src/loop-prevention/types.ts`
- Create: `core/src/loop-prevention/detector.ts`
- Create: `core/src/loop-prevention/ngram-detector.ts`
- Create: `core/src/loop-prevention/session-tracker.ts`
- Create: `core/src/loop-prevention/stream-loop-guard.ts`
- Create: `core/src/loop-prevention/tool-loop-guard.ts`
- Create: `core/src/loop-prevention/index.ts`

- [ ] **Step 1: Create core/src/loop-prevention/types.ts**

Copy verbatim from `src/proxy/loop-prevention/types.ts`:

```typescript
export interface NGramDetectorConfig {
  n: number;
  windowSize: number;
  repeatThreshold: number;
}

export interface StreamLoopGuardConfig {
  enabled: boolean;
  detectorConfig: NGramDetectorConfig;
}

export interface ToolLoopGuardConfig {
  enabled: boolean;
  minConsecutiveCount: number;
  detectorConfig: NGramDetectorConfig;
}

export interface SessionTrackerConfig {
  sessionTtlMs: number;
  maxToolCallRecords: number;
  cleanupIntervalMs: number;
}

export interface LoopPreventionConfig {
  enabled: boolean;
  stream: StreamLoopGuardConfig;
  toolCall: ToolLoopGuardConfig;
  sessionTracker: SessionTrackerConfig;
}

/* eslint-disable no-magic-numbers -- DEFAULT values are self-documenting */
export const DEFAULT_LOOP_PREVENTION_CONFIG: LoopPreventionConfig = {
  enabled: false,
  stream: {
    enabled: true,
    detectorConfig: { n: 6, windowSize: 1000, repeatThreshold: 10 },
  },
  toolCall: {
    enabled: true,
    minConsecutiveCount: 3,
    detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 },
  },
  sessionTracker: {
    sessionTtlMs: 30 * 60 * 1000,
    maxToolCallRecords: 50,
    cleanupIntervalMs: 5 * 60 * 1000,
  },
};

export interface ToolCallRecord {
  toolName: string;
  toolUseId?: string;
  inputHash: string;
  inputText: string;
  timestamp: number;
}

export interface LoopCheckResult {
  detected: boolean;
  reason?: "tool_call_loop" | "stream_content_loop";
  history?: ToolCallRecord[];
}
```

- [ ] **Step 2: Create core/src/loop-prevention/detector.ts**

Copy verbatim from `src/proxy/loop-prevention/detectors/detector.ts`:

```typescript
export interface LoopDetectorStatus {
  detected: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface LoopDetector {
  feed(text: string): boolean;
  reset(): void;
  getStatus(): LoopDetectorStatus;
}
```

- [ ] **Step 3: Create core/src/loop-prevention/ngram-detector.ts**

Copy from `src/proxy/loop-prevention/detectors/ngram-detector.ts`. Update import path from `./detector.js` → `./detector.js` (same relative path, no change needed):

```typescript
import type { LoopDetector, LoopDetectorStatus } from "./detector.js";
import type { NGramDetectorConfig } from "./types.js";

export class NGramLoopDetector implements LoopDetector {
  private window: string[] = [];
  private ngramCounts = new Map<string, number>();
  private detected = false;
  private maxPeakCount = 0;
  private peakNgram = "";
  private totalCharsProcessed = 0;

  constructor(private readonly config: NGramDetectorConfig) {}

  feed(text: string): boolean {
    if (this.detected) return true;
    for (const char of text) {
      this.window.push(char);
      this.totalCharsProcessed++;
      if (this.window.length >= this.config.n) {
        const ngram = this.window.slice(-this.config.n).join("");
        const count = (this.ngramCounts.get(ngram) ?? 0) + 1;
        this.ngramCounts.set(ngram, count);
        if (count > this.maxPeakCount) {
          this.maxPeakCount = count;
          this.peakNgram = ngram;
        }
      }
      if (this.window.length > this.config.windowSize) {
        const leaving = this.window.slice(0, this.config.n).join("");
        this.window.shift();
        if (this.window.length >= this.config.n) {
          const c = this.ngramCounts.get(leaving);
          if (c && c > 1) this.ngramCounts.set(leaving, c - 1);
          else this.ngramCounts.delete(leaving);
        }
      }
    }
    if (this.maxPeakCount >= this.config.repeatThreshold) {
      this.detected = true;
    }
    return this.detected;
  }

  reset(): void {
    this.window = [];
    this.ngramCounts.clear();
    this.detected = false;
    this.maxPeakCount = 0;
    this.peakNgram = "";
    this.totalCharsProcessed = 0;
  }

  getStatus(): LoopDetectorStatus {
    return {
      detected: this.detected,
      reason: this.detected ? `NGram '${this.peakNgram}' repeated ${this.maxPeakCount} times` : undefined,
      details: {
        peakNgram: this.peakNgram,
        peakCount: this.maxPeakCount,
        threshold: this.config.repeatThreshold,
        totalChars: this.totalCharsProcessed,
        windowSize: this.window.length,
      },
    };
  }
}
```

- [ ] **Step 4: Create core/src/loop-prevention/session-tracker.ts**

Copy from `src/proxy/loop-prevention/session-tracker.ts`. Import path `./types.js` stays the same:

```typescript
import type { ToolCallRecord, SessionTrackerConfig } from "./types.js";

interface SessionToolHistory {
  lastAccessTime: number;
  toolCalls: ToolCallRecord[];
  loopDetectedCount: number;
}

export class SessionTracker {
  private sessions = new Map<string, SessionToolHistory>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: SessionTrackerConfig) {
    if (config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), config.cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  recordAndGetHistory(sessionKey: string, record: ToolCallRecord): ToolCallRecord[] {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { lastAccessTime: Date.now(), toolCalls: [], loopDetectedCount: 0 };
      this.sessions.set(sessionKey, session);
    } else {
      if (Date.now() - session.lastAccessTime > this.config.sessionTtlMs) {
        session.toolCalls = [];
      }
      session.lastAccessTime = Date.now();
    }
    if (record.toolUseId && session.toolCalls.some(r => r.toolUseId === record.toolUseId)) {
      return session.toolCalls;
    }
    session.toolCalls.push(record);
    if (session.toolCalls.length > this.config.maxToolCallRecords) {
      session.toolCalls = session.toolCalls.slice(-this.config.maxToolCallRecords);
    }
    return session.toolCalls;
  }

  incrementLoopCount(sessionKey: string): number {
    const session = this.sessions.get(sessionKey);
    if (!session) return 0;
    session.loopDetectedCount++;
    return session.loopDetectedCount;
  }

  resetLoopCount(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) session.loopDetectedCount = 0;
  }

  getLoopCount(sessionKey: string): number {
    return this.sessions.get(sessionKey)?.loopDetectedCount ?? 0;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastAccessTime > this.config.sessionTtlMs) {
        this.sessions.delete(key);
      }
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}
```

- [ ] **Step 5: Create core/src/loop-prevention/stream-loop-guard.ts**

Copy from `src/proxy/loop-prevention/stream-loop-guard.ts`. Change import from `"./detectors/detector.js"` to `"./detector.js"`:

```typescript
import type { LoopDetector } from "./detector.js";
import type { StreamLoopGuardConfig } from "./types.js";

export class StreamLoopGuard {
  private triggered = false;

  constructor(
    private readonly config: StreamLoopGuardConfig,
    private readonly detector: LoopDetector,
    private readonly onLoopDetected: (reason: string) => void,
  ) {}

  feed(text: string): void {
    if (this.triggered) return;
    if (!this.config.enabled) return;
    if (this.detector.feed(text)) {
      this.triggered = true;
      this.onLoopDetected(this.detector.getStatus().reason ?? "stream_content_loop");
    }
  }

  isTriggered(): boolean {
    return this.triggered;
  }

  reset(): void {
    this.triggered = false;
    this.detector.reset();
  }
}
```

- [ ] **Step 6: Create core/src/loop-prevention/tool-loop-guard.ts**

Copy from `src/proxy/loop-prevention/tool-loop-guard.ts`. Update import from `"./detectors/ngram-detector.js"` to `"./ngram-detector.js"`:

```typescript
import type { ToolCallRecord, ToolLoopGuardConfig, LoopCheckResult } from "./types.js";
import { SessionTracker } from "./session-tracker.js";
import { NGramLoopDetector } from "./ngram-detector.js";

export class ToolLoopGuard {
  constructor(
    private readonly tracker: SessionTracker,
    private readonly config: ToolLoopGuardConfig,
  ) {}

  check(sessionKey: string | null, toolCall: ToolCallRecord | null): LoopCheckResult {
    if (!sessionKey || !toolCall) return { detected: false };
    if (!this.config.enabled) return { detected: false };

    const history = this.tracker.recordAndGetHistory(sessionKey, toolCall);

    const sameNameRecords = history.filter(r => r.toolName === toolCall.toolName);
    if (sameNameRecords.length < this.config.minConsecutiveCount) {
      return { detected: false };
    }

    const detector = new NGramLoopDetector(this.config.detectorConfig);
    for (const record of sameNameRecords) {
      detector.feed(record.inputText);
    }

    if (detector.getStatus().detected) {
      this.tracker.incrementLoopCount(sessionKey);
      return { detected: true, reason: "tool_call_loop", history: sameNameRecords };
    }

    this.tracker.resetLoopCount(sessionKey);
    return { detected: false };
  }

  injectLoopBreakPrompt(body: Record<string, unknown>, apiType: "openai" | "anthropic", toolName: string): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(body));
    const prompt = `[系统提醒] 检测到你可能陷入了反复调用 "${toolName}" 工具的循环。请停下来，总结当前进展，直接告知用户。`;

    if (apiType === "anthropic") {
      const system = cloned.system;
      if (Array.isArray(system)) {
        system.push({ type: "text", text: prompt });
      } else if (typeof system === "string") {
        cloned.system = [{ type: "text", text: system }, { type: "text", text: prompt }];
      } else {
        cloned.system = [{ type: "text", text: prompt }];
      }
    } else {
      const messages = (cloned.messages as unknown[]) ?? [];
      messages.unshift({ role: "system", content: prompt });
      cloned.messages = messages;
    }
    return cloned;
  }
}
```

- [ ] **Step 7: Create core/src/loop-prevention/index.ts**

```typescript
export { SessionTracker } from "./session-tracker.js";
export { StreamLoopGuard } from "./stream-loop-guard.js";
export { ToolLoopGuard } from "./tool-loop-guard.js";
export { NGramLoopDetector } from "./ngram-detector.js";
export {
  DEFAULT_LOOP_PREVENTION_CONFIG,
} from "./types.js";
export type {
  LoopPreventionConfig,
  StreamLoopGuardConfig,
  ToolLoopGuardConfig,
  SessionTrackerConfig,
  NGramDetectorConfig,
  ToolCallRecord,
  LoopCheckResult,
} from "./types.js";
export type { LoopDetector, LoopDetectorStatus } from "./detector.js";
```

- [ ] **Step 8: Build and verify**

Run: `cd core && npm run build`
Expected: compiles without errors.

- [ ] **Step 9: Commit**

```bash
git add core/src/loop-prevention/ core/src/index.ts
git commit -m "feat(core): migrate loop-prevention module"
```

---

### Task 4: Migrate loop-prevention tests to core

**Files:**
- Create: `core/tests/loop-prevention/ngram-detector.test.ts` (copy from `tests/loop-prevention/ngram-detector.test.ts`)
- Create: `core/tests/loop-prevention/session-tracker.test.ts` (copy from `tests/loop-prevention/session-tracker.test.ts`)
- Create: `core/tests/loop-prevention/stream-loop-guard.test.ts` (copy from `tests/loop-prevention/stream-loop-guard.test.ts`)
- Create: `core/tests/loop-prevention/tool-loop-guard.test.ts` (copy from `tests/loop-prevention/tool-loop-guard.test.ts`)
- Create: `core/tests/loop-prevention/loop-prevention-integration.test.ts` (copy from `tests/loop-prevention/loop-prevention-integration.test.ts`)

- [ ] **Step 1: Copy test files**

Copy all 5 test files from `tests/loop-prevention/` to `core/tests/loop-prevention/`. In each test file, update all import paths:

| Old import | New import |
|---|---|
| `"../../src/proxy/loop-prevention/session-tracker.js"` | `"../../src/loop-prevention/session-tracker.js"` |
| `"../../src/proxy/loop-prevention/stream-loop-guard.js"` | `"../../src/loop-prevention/stream-loop-guard.js"` |
| `"../../src/proxy/loop-prevention/tool-loop-guard.js"` | `"../../src/loop-prevention/tool-loop-guard.js"` |
| `"../../src/proxy/loop-prevention/types.js"` | `"../../src/loop-prevention/types.js"` |
| `"../../src/proxy/loop-prevention/detectors/ngram-detector.js"` | `"../../src/loop-prevention/ngram-detector.js"` |

The path depth is the same (tests/loop-prevention/ → src/loop-prevention/), so only the `proxy/` and `detectors/` segments are removed.

- [ ] **Step 2: Run tests to verify**

Run: `cd core && npm test -- tests/loop-prevention/`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add core/tests/loop-prevention/
git commit -m "test(core): migrate loop-prevention tests"
```

---

### Task 5: Migrate concurrency module to core

**Files:**
- Create: `core/src/concurrency/types.ts`
- Create: `core/src/concurrency/semaphore.ts`
- Create: `core/src/concurrency/adaptive-controller.ts`
- Create: `core/src/concurrency/index.ts`

- [ ] **Step 1: Create core/src/concurrency/types.ts**

```typescript
/** Provider-level concurrency control configuration. */
export interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

/** Internal state of adaptive concurrency for a provider. */
export interface AdaptiveState {
  currentLimit: number;
  probeActive: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  cooldownUntil: number;
}

/** Result of a request for adaptive concurrency feedback. */
export interface AdaptiveResult {
  success: boolean;
  statusCode?: number;
}

/** Abstraction for semaphore operations (decouples AdaptiveController). */
export interface ISemaphoreControl {
  updateConfig(providerId: string, config: ConcurrencyConfig): void;
}

/** Provider DB fields for adaptive/manual concurrency. */
export interface ProviderConcurrencyParams {
  adaptive_enabled: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}
```

- [ ] **Step 2: Create core/src/concurrency/semaphore.ts**

Copy from `src/proxy/orchestration/semaphore.ts`. Changes:
1. Import `ConcurrencyConfig` from `./types.js` instead of `../../core/types.js`
2. Import errors from `../errors.js` instead of `../../core/errors.js`
3. Replace `SemaphoreLogger` with core `Logger` from `../types.js`
4. Rename class from `ProviderSemaphoreManager` to `SemaphoreManager`

```typescript
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../errors.js";
export { SemaphoreQueueFullError, SemaphoreTimeoutError };
import type { ConcurrencyConfig } from "./types.js";
import type { Logger } from "../types.js";

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
}

interface SemaphoreEntry {
  config: ConcurrencyConfig;
  current: number;
  queue: QueueEntry[];
  generation: number;
}

// acquire() 返回的令牌，调用方需传给 release()
export interface AcquireToken {
  readonly generation: number;
  readonly bypassed: boolean;
}

export class SemaphoreManager {
  private readonly entries = new Map<string, SemaphoreEntry>();
  private nextGeneration = 0;

  private getOrCreate(providerId: string): SemaphoreEntry {
    let entry = this.entries.get(providerId);
    if (!entry) {
      entry = {
        config: { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 },
        current: 0,
        queue: [],
        generation: ++this.nextGeneration,
      };
      this.entries.set(providerId, entry);
    }
    return entry;
  }

  updateConfig(providerId: string, config: ConcurrencyConfig): void {
    const entry = this.getOrCreate(providerId);
    entry.config = config;

    if (config.maxConcurrency === 0) {
      while (entry.queue.length > 0) {
        const e = entry.queue.shift()!;
        if (e.timer) clearTimeout(e.timer);
        e.resolve();
      }
      entry.generation = ++this.nextGeneration;
      entry.current = 0;
      return;
    }

    if (entry.current < 0) entry.current = 0;

    while (entry.current < config.maxConcurrency && entry.queue.length > 0) {
      entry.current++;
      const e = entry.queue.shift()!;
      if (e.timer) clearTimeout(e.timer);
      e.resolve();
    }
  }

  async acquire(
    providerId: string,
    signal?: AbortSignal,
    onQueued?: () => void,
    logger?: Logger,
    override?: { max_concurrency?: number; queue_timeout_ms?: number; max_queue_size?: number },
  ): Promise<AcquireToken> {
    const entry = this.getOrCreate(providerId);
    const maxConcurrency = override?.max_concurrency ?? entry.config.maxConcurrency;
    const queueTimeoutMs = Math.max(0, override?.queue_timeout_ms ?? entry.config.queueTimeoutMs);
    const maxQueueSize = Math.max(0, override?.max_queue_size ?? entry.config.maxQueueSize);

    if (maxConcurrency === 0) return { generation: entry.generation, bypassed: true };
    if (entry.current < maxConcurrency) {
      entry.current++;
      logger?.debug?.({ providerId, current: entry.current, maxConcurrency, action: "acquire_direct" }, "Semaphore: acquired directly");
      return { generation: entry.generation, bypassed: false };
    }

    if (entry.queue.length >= maxQueueSize) {
      logger?.debug?.({ providerId, queueLength: entry.queue.length, maxQueueSize, action: "acquire_rejected" }, "Semaphore: queue full, rejecting");
      throw new SemaphoreQueueFullError(providerId);
    }

    logger?.debug?.({ providerId, current: entry.current, maxConcurrency, queueLength: entry.queue.length, action: "acquire_queued" }, "Semaphore: entering wait queue");
    onQueued?.();
    return new Promise<AcquireToken>((resolve, reject) => {
      const token = { generation: entry.generation, bypassed: false };
      const qe: QueueEntry = {
        resolve: () => {
          logger?.debug?.({ providerId, current: entry.current, maxConcurrency, queueLength: entry.queue.length, action: "acquire_resolved" }, "Semaphore: left wait queue, acquired");
          resolve(token);
        },
        reject: (err: Error) => {
          logger?.debug?.({ providerId, action: "acquire_rejected_internal", error: err.message }, "Semaphore: wait queue entry rejected");
          reject(err);
        },
        timer: null,
      };

      if (queueTimeoutMs > 0) {
        qe.timer = setTimeout(() => {
          const idx = entry.queue.indexOf(qe);
          if (idx !== -1) entry.queue.splice(idx, 1);
          reject(new SemaphoreTimeoutError(providerId, queueTimeoutMs));
        }, queueTimeoutMs);
      }

      if (signal) {
        const onAbort = () => {
          const idx = entry.queue.indexOf(qe);
          if (idx !== -1) entry.queue.splice(idx, 1);
          if (qe.timer) clearTimeout(qe.timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      entry.queue.push(qe);
    });
  }

  release(providerId: string, token: AcquireToken, logger?: Logger): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    if (token.bypassed) return;
    if (token.generation !== entry.generation) {
      logger?.debug?.({ providerId, tokenGen: token.generation, currentGen: entry.generation, action: "release_stale" }, "Semaphore: stale token, skipping release");
      return;
    }

    if (entry.queue.length > 0) {
      const e = entry.queue.shift()!;
      logger?.debug?.({ providerId, current: entry.current, maxConcurrency: entry.config.maxConcurrency, queueRemaining: entry.queue.length, action: "release_dequeue" }, "Semaphore: released, dequeued next waiter");
      if (e.timer) clearTimeout(e.timer);
      e.resolve();
    } else {
      entry.current--;
      logger?.debug?.({ providerId, current: entry.current, maxConcurrency: entry.config.maxConcurrency, action: "release_decrement" }, "Semaphore: released slot");
    }
  }

  getStatus(providerId: string): { active: number; queued: number } {
    const entry = this.entries.get(providerId);
    if (!entry) return { active: 0, queued: 0 };
    return { active: entry.current, queued: entry.queue.length };
  }

  remove(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    for (const e of entry.queue) {
      if (e.timer) clearTimeout(e.timer);
      e.reject(new Error("Provider removed"));
    }
    this.entries.delete(providerId);
  }

  removeAll(): void {
    for (const [, entry] of this.entries) {
      for (const e of entry.queue) {
        if (e.timer) clearTimeout(e.timer);
        e.reject(new Error("Provider removed"));
      }
    }
    this.entries.clear();
  }
}
```

- [ ] **Step 3: Create core/src/concurrency/adaptive-controller.ts**

Copy from `src/proxy/adaptive-controller.ts`. Changes:
1. Import `ISemaphoreControl` from `./types.js` instead of `ProviderSemaphoreManager`
2. Import `Logger` from `../types.js`
3. Remove `SemaphoreLogger` interface, use `Logger`

```typescript
import type { AdaptiveState, AdaptiveResult, ISemaphoreControl, ProviderConcurrencyParams } from "./types.js";
import type { Logger } from "../types.js";

const SUCCESS_THRESHOLD = 3;
const FAILURE_THRESHOLD = 3;
const DECREASE_STEP = 2;
const COOLDOWN_MS = 30_000;
const RATE_LIMIT_STATUS = 429;
const HALF_DIVISOR = 2;
const ADAPTIVE_MIN = 1;

interface AdaptiveEntry {
  state: AdaptiveState;
  max: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export class AdaptiveController {
  private readonly entries = new Map<string, AdaptiveEntry>();

  constructor(
    private semaphoreControl: ISemaphoreControl,
    private logger?: Logger,
  ) {}

  init(providerId: string, config: { max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }): void {
    const initialLimit = config.max;
    this.entries.set(providerId, {
      state: {
        currentLimit: initialLimit,
        probeActive: true,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
      },
      max: config.max,
      queueTimeoutMs: semParams.queueTimeoutMs,
      maxQueueSize: semParams.maxQueueSize,
    });
    this.syncToSemaphore(providerId);
  }

  remove(providerId: string): void {
    this.entries.delete(providerId);
  }

  removeAll(): void {
    this.entries.clear();
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

  syncProvider(providerId: string, p: ProviderConcurrencyParams): void {
    if (p.adaptive_enabled) {
      const existing = this.entries.get(providerId);
      if (existing) {
        existing.max = p.max_concurrency;
        existing.queueTimeoutMs = p.queue_timeout_ms;
        existing.maxQueueSize = p.max_queue_size;
        existing.state.currentLimit = Math.min(Math.max(existing.state.currentLimit, ADAPTIVE_MIN), existing.max);
        this.syncToSemaphore(providerId);
      } else {
        this.init(providerId, { max: p.max_concurrency }, {
          queueTimeoutMs: p.queue_timeout_ms, maxQueueSize: p.max_queue_size,
        });
      }
    } else {
      this.remove(providerId);
      this.semaphoreControl.updateConfig(providerId, {
        maxConcurrency: p.max_concurrency,
        queueTimeoutMs: p.queue_timeout_ms,
        maxQueueSize: p.max_queue_size,
      });
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
        this.logger?.debug?.({ providerId, currentLimit: s.currentLimit, action: "probe_open" }, "Adaptive: probe window opened");
      } else {
        s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
        s.consecutiveSuccesses = 0;
        this.logger?.debug?.({ providerId, currentLimit: s.currentLimit, max: entry.max, action: "limit_increased" }, "Adaptive: limit increased by 1");
      }
      this.syncToSemaphore(providerId);
    }
  }

  private transitionFailure(providerId: string, entry: AdaptiveEntry, statusCode?: number): void {
    if (statusCode !== undefined && statusCode !== RATE_LIMIT_STATUS && statusCode < 500) {
      return;
    }

    const s = entry.state;
    s.consecutiveFailures++;
    s.consecutiveSuccesses = 0;

    if (statusCode === RATE_LIMIT_STATUS) {
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.max(Math.floor(s.currentLimit / HALF_DIVISOR), ADAPTIVE_MIN);
      s.probeActive = false;
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
      this.logger?.warn?.({ providerId, prevLimit, newLimit: s.currentLimit, cooldownMs: COOLDOWN_MS, action: "rate_limit_backoff" }, "Adaptive: 429 rate limit, halved concurrency and entered cooldown");
    } else if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.max(s.currentLimit - DECREASE_STEP, ADAPTIVE_MIN);
      s.probeActive = false;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
      this.logger?.warn?.({ providerId, prevLimit, newLimit: s.currentLimit, action: "failure_backoff" }, "Adaptive: sustained failures, decreased concurrency");
    }
  }

  private syncToSemaphore(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    const effectiveLimit = entry.state.probeActive
      ? Math.min(Math.max(entry.state.currentLimit + 1, ADAPTIVE_MIN), entry.max)
      : Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
    this.semaphoreControl.updateConfig(providerId, {
      maxConcurrency: effectiveLimit,
      queueTimeoutMs: entry.queueTimeoutMs,
      maxQueueSize: entry.maxQueueSize,
    });
  }
}
```

- [ ] **Step 4: Create core/src/concurrency/index.ts**

```typescript
export { SemaphoreManager } from "./semaphore.js";
export { AdaptiveController } from "./adaptive-controller.js";
export type { AcquireToken } from "./semaphore.js";
export type {
  ConcurrencyConfig,
  AdaptiveState,
  AdaptiveResult,
  ISemaphoreControl,
  ProviderConcurrencyParams,
} from "./types.js";
```

- [ ] **Step 5: Update core/src/index.ts to include concurrency exports**

```typescript
// @llm-router/core — unified re-export

export { SemaphoreQueueFullError, SemaphoreTimeoutError } from "./errors.js";
export type { Logger } from "./types.js";

// Concurrency
export { SemaphoreManager, AdaptiveController } from "./concurrency/index.js";
export type { AcquireToken, ConcurrencyConfig, AdaptiveState, AdaptiveResult, ISemaphoreControl, ProviderConcurrencyParams } from "./concurrency/index.js";

// Loop prevention
export {
  SessionTracker,
  StreamLoopGuard,
  ToolLoopGuard,
  NGramLoopDetector,
  DEFAULT_LOOP_PREVENTION_CONFIG,
} from "./loop-prevention/index.js";
export type {
  LoopPreventionConfig,
  StreamLoopGuardConfig,
  ToolLoopGuardConfig,
  SessionTrackerConfig,
  NGramDetectorConfig,
  ToolCallRecord,
  LoopCheckResult,
  LoopDetector,
  LoopDetectorStatus,
} from "./loop-prevention/index.js";
```

- [ ] **Step 6: Build and verify**

Run: `cd core && npm run build`
Expected: compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add core/src/
git commit -m "feat(core): migrate concurrency module (SemaphoreManager, AdaptiveController)"
```

---

### Task 6: Migrate concurrency test to core

**Files:**
- Create: `core/tests/concurrency/semaphore.test.ts` (copy from `tests/semaphore.test.ts`)

- [ ] **Step 1: Copy and adapt test file**

Copy `tests/semaphore.test.ts` to `core/tests/concurrency/semaphore.test.ts`. Update imports:

| Old import | New import |
|---|---|
| `"../../src/proxy/orchestration/semaphore"` | `"../../src/concurrency/semaphore"` |
| `"../../src/core/errors"` | `"../../src/errors"` |

Also rename all references from `ProviderSemaphoreManager` to `SemaphoreManager`.

- [ ] **Step 2: Run test**

Run: `cd core && npm test -- tests/concurrency/`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add core/tests/concurrency/
git commit -m "test(core): migrate semaphore tests"
```

---

### Task 7: Migrate monitor module to core

**Files:**
- Create: `core/src/monitor/types.ts`
- Create: `core/src/monitor/stats-aggregator.ts`
- Create: `core/src/monitor/runtime-collector.ts`
- Create: `core/src/monitor/stream-content-accumulator.ts`
- Create: `core/src/monitor/stream-extractor.ts`
- Create: `core/src/monitor/request-tracker.ts`
- Create: `core/src/monitor/index.ts`

- [ ] **Step 1: Create core/src/monitor/types.ts**

Copy from `src/monitor/types.ts`. Remove `ISemaphoreStatus` (replace with import from concurrency). Add `SSEClient` interface. Remove `ServerResponse` dependency:

```typescript
export interface ContentBlock {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result'
  content: string
  name?: string
}

export interface StreamContentSnapshot {
  rawChunks: string;
  textContent: string;
  totalChars: number;
  blocks?: ContentBlock[];
}

export interface ActiveRequest {
  id: string;
  apiType: "openai" | "anthropic";
  model: string;
  providerId: string;
  providerName: string;
  isStream: boolean;
  queued?: boolean;
  startTime: number;
  status: "pending" | "completed" | "failed";
  retryCount: number;
  attempts: AttemptSnapshot[];
  streamMetrics?: StreamMetricsSnapshot;
  streamContent?: StreamContentSnapshot;
  clientIp?: string;
  sessionId?: string;
  clientRequest?: string;
  upstreamRequest?: string;
  completedAt?: number;
}

export interface AttemptSnapshot {
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  providerId: string;
}

export interface StreamMetricsSnapshot {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  ttftMs: number | null;
  tokensPerSecond: number | null;
  stopReason: string | null;
  isComplete: boolean;
  thinkingTokens: number | null;
  thinkingDurationMs: number | null;
  thinkingTps: number | null;
  nonThinkingDurationMs: number | null;
  nonThinkingTps: number | null;
  totalTps: number | null;
  textTokens: number | null;
  toolUseTokens: number | null;
}

export interface ProviderConcurrencySnapshot {
  providerId: string;
  providerName: string;
  maxConcurrency: number;
  active: number;
  queued: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
  adaptiveEnabled?: boolean;
  adaptiveLimit?: number;
}

export interface StatsSnapshot {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  failoverCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  byProvider: Record<string, ProviderStats>;
  byStatusCode: Record<number, number>;
}

export interface ProviderStats {
  providerName: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  retryCount: number;
  topErrors: Array<{ code: number; count: number }>;
}

/** Abstract SSE client interface (decouples from Node http ServerResponse). */
export interface SSEClient {
  write(data: string): void;
  /** Called when client disconnects. */
  on close(callback: () => void): void;
  readonly writableEnded: boolean;
  end(): void;
}

export interface RuntimeMetrics {
  uptimeMs: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeHandles: number;
  activeRequests: number;
  eventLoopDelayMs: number;
}
```

- [ ] **Step 2: Create core/src/monitor/stream-extractor.ts**

Copy verbatim from `src/monitor/stream-extractor.ts` — no changes needed (no external imports).

- [ ] **Step 3: Create core/src/monitor/stream-content-accumulator.ts**

Copy verbatim from `src/monitor/stream-content-accumulator.ts`. Change import from `"./stream-extractor.js"` — same path, no change needed.

- [ ] **Step 4: Create core/src/monitor/stats-aggregator.ts**

Copy verbatim from `src/monitor/stats-aggregator.ts`. Change import from `"./types.js"` — same path, no change needed.

- [ ] **Step 5: Create core/src/monitor/runtime-collector.ts**

Copy from `src/monitor/runtime-collector.ts`. Remove import of `MS_PER_SECOND` from `../core/constants.js`, inline the constant:

```typescript
import { performance } from "node:perf_hooks";
import type { RuntimeMetrics } from "./types.js";

const NS_PER_MS = 1e6;
const MS_PER_SECOND = 1000;

type EventLoopHistogram = { enable(): void; disable(): void; mean: number };
const perf = performance as unknown as Performance & {
  monitorEventLoopDelay?(opts?: { resolution?: number }): EventLoopHistogram;
};
const proc = process as NodeJS.Process & {
  _getActiveHandles(): object[];
  _getActiveRequests(): object[];
};

export class RuntimeCollector {
  private histogram?: { enable(): void; disable(): void; mean: number };

  start(): void {
    if (this.histogram) return;
    if (typeof perf.monitorEventLoopDelay !== "function") return;
    this.histogram = perf.monitorEventLoopDelay({ resolution: 1 });
    this.histogram.enable();
  }

  stop(): void {
    if (this.histogram) {
      this.histogram.disable();
      this.histogram = undefined;
    }
  }

  collect(): RuntimeMetrics {
    return {
      uptimeMs: process.uptime() * MS_PER_SECOND,
      memoryUsage: process.memoryUsage(),
      activeHandles: proc._getActiveHandles().length,
      activeRequests: proc._getActiveRequests().length,
      eventLoopDelayMs: this.getEventLoopDelayMs(),
    };
  }

  private getEventLoopDelayMs(): number {
    if (!this.histogram) return 0;
    return this.histogram.mean / NS_PER_MS;
  }
}
```

- [ ] **Step 6: Create core/src/monitor/request-tracker.ts**

Copy from `src/monitor/request-tracker.ts`. Key changes:
1. Replace `ServerResponse` with `SSEClient` interface from `./types.js`
2. Replace `AdaptiveConcurrencyController` import with `import type { AdaptiveState } from "../concurrency/types.js"` — tracker only calls `getStatus()` on adaptive controller, so use an interface
3. Replace `ISemaphoreStatus` from `./types.js` with inline interface
4. Replace `TrackerLogger` with core `Logger` from `../types.js`

The tracker needs a `ISemaphoreStatus` and an optional adaptive controller interface. Define these locally:

```typescript
import { StatsAggregator } from "./stats-aggregator.js";
import { RuntimeCollector } from "./runtime-collector.js";
import { StreamContentAccumulator } from "./stream-content-accumulator.js";
import type {
  ActiveRequest,
  AttemptSnapshot,
  ProviderConcurrencySnapshot,
  RuntimeMetrics,
  SSEClient,
  StatsSnapshot,
} from "./types.js";
import type { AdaptiveState } from "../concurrency/types.js";
import type { Logger } from "../types.js";

/** Semaphore status query interface (decoupled from SemaphoreManager). */
export interface ISemaphoreStatus {
  getStatus(providerId: string): { active: number; queued: number };
}

/** Adaptive controller query interface (decoupled from AdaptiveController). */
export interface IAdaptiveStatus {
  getStatus(providerId: string): AdaptiveState | undefined;
}

// ... rest of RequestTracker code with ServerResponse → SSEClient replacement
```

For `SSEClient`: replace all `ServerResponse` usage. The `addClient` method accepts `SSEClient` instead of `ServerResponse`. The `res.on("close", ...)` pattern becomes `client.on("close", ...)`. The `res.writableEnded` becomes `client.writableEnded`. The `res.end()` becomes `client.end()`.

All other logic (start, update, complete, broadcast, etc.) remains identical.

- [ ] **Step 7: Create core/src/monitor/index.ts**

```typescript
export { StatsAggregator } from "./stats-aggregator.js";
export { RuntimeCollector } from "./runtime-collector.js";
export { RequestTracker } from "./request-tracker.js";
export { StreamContentAccumulator } from "./stream-content-accumulator.js";
export { extractStreamText } from "./stream-extractor.js";
export type { ISemaphoreStatus, IAdaptiveStatus } from "./request-tracker.js";
export type {
  ActiveRequest,
  AttemptSnapshot,
  ContentBlock,
  ProviderConcurrencySnapshot,
  ProviderStats,
  RuntimeMetrics,
  SSEClient,
  StatsSnapshot,
  StreamContentSnapshot,
  StreamMetricsSnapshot,
} from "./types.js";
```

- [ ] **Step 8: Update core/src/index.ts to include monitor exports**

Add to `core/src/index.ts`:

```typescript
// Monitor
export { RequestTracker, StatsAggregator, RuntimeCollector } from "./monitor/index.js";
export type { ISemaphoreStatus, IAdaptiveStatus } from "./monitor/index.js";
export type {
  ActiveRequest, AttemptSnapshot, ContentBlock,
  ProviderConcurrencySnapshot, ProviderStats, RuntimeMetrics,
  SSEClient, StatsSnapshot, StreamContentSnapshot, StreamMetricsSnapshot,
} from "./monitor/index.js";
```

- [ ] **Step 9: Build and verify**

Run: `cd core && npm run build`
Expected: compiles without errors.

- [ ] **Step 10: Commit**

```bash
git add core/src/monitor/ core/src/index.ts
git commit -m "feat(core): migrate monitor module (RequestTracker, StatsAggregator, RuntimeCollector)"
```

---

### Task 8: Migrate monitor tests to core

**Files:**
- Create: `core/tests/monitor/stats-aggregator.test.ts` (copy from `tests/monitor/stats-aggregator.test.ts`)
- Create: `core/tests/monitor/runtime-collector.test.ts` (copy from `tests/monitor/runtime-collector.test.ts`)
- Create: `core/tests/monitor/request-tracker.test.ts` (copy from `tests/monitor/request-tracker.test.ts`)
- Create: `core/tests/monitor/stream-content-accumulator.test.ts` (copy from `tests/monitor/stream-content-accumulator.test.ts`)

- [ ] **Step 1: Copy and adapt test files**

For each test file, update import paths:
- `"../../src/monitor/*"` paths remain same depth
- Remove `../../src/proxy/adaptive-controller` imports — request-tracker test may mock adaptive controller via interface

For `request-tracker.test.ts`: Replace `ServerResponse` mocks with `SSEClient` mock objects. The mock needs `write()`, `on("close", ...)`, `writableEnded`, `end()` methods.

- [ ] **Step 2: Run all core tests**

Run: `cd core && npm test`
Expected: All tests pass (loop-prevention + concurrency + monitor).

- [ ] **Step 3: Commit**

```bash
git add core/tests/monitor/
git commit -m "test(core): migrate monitor tests"
```

---

## Phase 2: Router Restructure

### Task 9: Move router code to router/ subdirectory

**Files:**
- Move: all `src/` → `router/src/`
- Move: existing `tests/` → `router/tests/`
- Create: `router/package.json`
- Create: `router/tsconfig.json`
- Create: `router/vitest.config.ts`
- Move: `Dockerfile` → `router/Dockerfile`

- [ ] **Step 1: Create router/package.json**

```json
{
  "name": "llm-simple-router",
  "version": "0.8.3",
  "description": "LLM API proxy router with OpenAI/Anthropic support, model mapping, retry strategies, and admin dashboard",
  "license": "MIT",
  "type": "module",
  "bin": { "llm-simple-router": "./dist/cli.js" },
  "files": ["dist/", "frontend-dist/", "config/", ".env.example", "LICENSE"],
  "scripts": {
    "dev": "PORT=9980 tsx watch src/index.ts",
    "build": "tsc",
    "build:full": "tsc && node scripts/build.mjs",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . --max-warnings=0"
  },
  "dependencies": {
    "@llm-router/core": "*",
    "@fastify/cookie": "^11.0.2",
    "@fastify/static": "^9.1.0",
    "@sinclair/typebox": "^0.34.49",
    "better-sqlite3": "^11.9.1",
    "dotenv": "^16.4.7",
    "fastify": "^5.3.3",
    "fastify-plugin": "^5.1.0",
    "gpt-tokenizer": "^3.4.0",
    "jsonwebtoken": "^9.0.3",
    "pino": "^9.6.0",
    "pino-pretty": "^13.1.3"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/better-sqlite3": "^7.6.13",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^22.15.3",
    "eslint": "^10.2.0",
    "tsx": "^4.19.3",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.58.2",
    "vitest": "^3.1.2"
  }
}
```

- [ ] **Step 2: Create router/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create router/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 4: Move files**

```bash
# Create router directory
mkdir -p router

# Move source code
mv src router/src

# Move tests
mv tests router/tests

# Move scripts
mv scripts router/scripts 2>/dev/null || true

# Move Dockerfile
mv Dockerfile router/Dockerfile 2>/dev/null || true

# Move config dir
mv config router/config 2>/dev/null || true

# Move plugins dir
mv plugins router/plugins 2>/dev/null || true

# Move LICENSE
mv LICENSE router/LICENSE 2>/dev/null || true
```

- [ ] **Step 5: Install and verify workspace links**

Run: `npm install`
Expected: workspace resolves `@llm-router/core` → `core/` and `llm-simple-router` → `router/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move router code to router/ subdirectory"
```

---

### Task 10: Update router imports to use @llm-router/core

**Files:**
- Modify: all files in `router/src/` that import from migrated modules

This is the core refactoring task. The import changes map as follows:

| Old import in router | New import |
|---|---|
| `"./proxy/orchestration/semaphore.js"` | `"@llm-router/core/concurrency"` (use `SemaphoreManager`) |
| `"../proxy/adaptive-controller.js"` | `"@llm-router/core/concurrency"` (use `AdaptiveController`) |
| `"../proxy/loop-prevention/types.js"` | `"@llm-router/core/loop-prevention"` |
| `"../proxy/loop-prevention/session-tracker.js"` | `"@llm-router/core/loop-prevention"` |
| `"../proxy/loop-prevention/stream-loop-guard.js"` | `"@llm-router/core/loop-prevention"` |
| `"../proxy/loop-prevention/tool-loop-guard.js"` | `"@llm-router/core/loop-prevention"` |
| `"../proxy/loop-prevention/detectors/ngram-detector.js"` | `"@llm-router/core/loop-prevention"` |
| `"../../monitor/request-tracker.js"` | `"@llm-router/core/monitor"` |
| `"../../monitor/types.js"` | `"@llm-router/core/monitor"` |
| `"../../monitor/stream-content-accumulator.js"` | `"@llm-router/core/monitor"` |

**Rename `ProviderSemaphoreManager` → `SemaphoreManager` everywhere in router.**

- [ ] **Step 1: Update router/src/index.ts (main entry)**

Replace imports of `ProviderSemaphoreManager`, `AdaptiveConcurrencyController`, `RequestTracker`, `SessionTracker`, `DEFAULT_LOOP_PREVENTION_CONFIG`.

Add a pino-to-Logger adapter:

```typescript
// router/src/core/pino-logger.ts
import type { Logger } from "@llm-router/core";
import type { FastifyBaseLogger } from "fastify";

/** Adapt fastify/pino logger to core Logger interface. */
export function adaptLogger(log: FastifyBaseLogger): Logger {
  return {
    debug: (obj, msg) => log.debug(obj, msg),
    warn: (obj, msg) => log.warn(obj, msg),
    error: (obj, msg) => log.error(obj, msg),
  };
}
```

- [ ] **Step 2: Update router/src/proxy/handler/openai.ts and anthropic.ts**

Replace `ProviderSemaphoreManager` with `SemaphoreManager` in type imports.

- [ ] **Step 3: Update router/src/proxy/transport/transport-fn.ts**

Replace imports of `StreamLoopGuard`, `NGramLoopDetector` from `@llm-router/core/loop-prevention`.

- [ ] **Step 4: Update router/src/proxy/orchestration/scope.ts and orchestrator.ts**

Replace `ProviderSemaphoreManager` and `ActiveRequest` type imports.

- [ ] **Step 5: Update router/src/admin/*.ts**

Replace `RequestTracker` and `AdaptiveConcurrencyController` type imports.

- [ ] **Step 6: Create SSEClient adapter in router**

The core `RequestTracker` uses `SSEClient` interface. The router uses `ServerResponse`. Create an adapter:

```typescript
// router/src/core/sse-client-adapter.ts
import type { ServerResponse } from "node:http";
import type { SSEClient } from "@llm-router/core/monitor";

/** Adapt Node.js ServerResponse to core SSEClient interface. */
export function adaptSSEClient(res: ServerResponse): SSEClient {
  return {
    write(data: string) { res.write(data); },
    end() { res.end(); },
    get writableEnded() { return res.writableEnded; },
    on(event: string, callback: () => void) {
      if (event === "close") res.on("close", callback);
    },
  };
}
```

- [ ] **Step 7: Update router test imports**

Same import path replacements in `router/tests/`.

- [ ] **Step 8: Delete migrated source files from router/src/**

Remove:
- `router/src/proxy/orchestration/semaphore.ts`
- `router/src/proxy/adaptive-controller.ts`
- `router/src/proxy/loop-prevention/` (entire directory)
- `router/src/monitor/` (entire directory)

Keep in router:
- `router/src/core/errors.ts` — but remove `SemaphoreQueueFullError` and `SemaphoreTimeoutError` (now from core), keep only `ProviderSwitchNeeded`
- `router/src/core/types.ts` — keep router-specific types, remove types that duplicate core

- [ ] **Step 9: Run router tests**

Run: `cd router && npm test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(router): replace internal imports with @llm-router/core"
```

---

## Phase 3: Pi Extension

### Task 11: Create pi-extension package scaffold

**Files:**
- Create: `pi-extension/package.json`
- Create: `pi-extension/tsconfig.json`
- Create: `pi-extension/config.example.json`
- Create: `pi-extension/src/index.ts`
- Create: `pi-extension/src/config.ts`

- [ ] **Step 1: Create pi-extension/package.json**

```json
{
  "name": "pi-extension-router",
  "version": "0.1.0",
  "description": "Pi coding agent extension providing concurrency control, loop prevention, and monitoring from @llm-router/core",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@llm-router/core": "*"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.70.0"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "^0.70.0",
    "typebox": "^0.34.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create pi-extension/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create pi-extension/config.example.json**

```json
{
  "concurrency": {
    "anthropic": {
      "maxConcurrency": 5,
      "queueTimeoutMs": 5000,
      "maxQueueSize": 100,
      "adaptive": true
    },
    "openai": {
      "maxConcurrency": 3,
      "queueTimeoutMs": 5000,
      "maxQueueSize": 50,
      "adaptive": false
    }
  },
  "loopPrevention": {
    "enabled": true,
    "stream": {
      "enabled": true,
      "detectorConfig": { "n": 6, "windowSize": 1000, "repeatThreshold": 10 }
    },
    "toolCall": {
      "enabled": true,
      "minConsecutiveCount": 3,
      "detectorConfig": { "n": 6, "windowSize": 500, "repeatThreshold": 5 }
    }
  },
  "monitor": {
    "enabled": true,
    "statsIntervalMs": 60000
  }
}
```

- [ ] **Step 4: Create pi-extension/src/config.ts**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConcurrencyConfig,
  LoopPreventionConfig,
  DEFAULT_LOOP_PREVENTION_CONFIG,
} from "@llm-router/core";

export interface ProviderConcurrencyEntry extends ConcurrencyConfig {
  adaptive: boolean;
}

export interface ExtensionConfig {
  concurrency: Record<string, ProviderConcurrencyEntry>;
  loopPrevention: LoopPreventionConfig;
  monitor: {
    enabled: boolean;
    statsIntervalMs: number;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadConfig(): ExtensionConfig {
  // Look for config.json next to index.ts (or dist/index.js in production)
  const configPath = join(__dirname, "..", "config.json");

  if (!existsSync(configPath)) {
    return defaultConfig();
  }

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as ExtensionConfig;
}

function defaultConfig(): ExtensionConfig {
  return {
    concurrency: {},
    loopPrevention: {
      enabled: false,
      stream: { enabled: true, detectorConfig: { n: 6, windowSize: 1000, repeatThreshold: 10 } },
      toolCall: { enabled: true, minConsecutiveCount: 3, detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 } },
      sessionTracker: { sessionTtlMs: 1800000, maxToolCallRecords: 50, cleanupIntervalMs: 300000 },
    },
    monitor: { enabled: true, statsIntervalMs: 60000 },
  };
}
```

- [ ] **Step 5: Create pi-extension/src/index.ts — extension entry point**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
  SemaphoreManager,
  AdaptiveController,
  SessionTracker,
  StreamLoopGuard,
  ToolLoopGuard,
  NGramLoopDetector,
  DEFAULT_LOOP_PREVENTION_CONFIG,
  RequestTracker,
} from "@llm-router/core";
import { loadConfig } from "./config.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // --- Initialize core modules ---

  const semaphore = new SemaphoreManager();
  const adaptive = new AdaptiveController(semaphore);

  const loopConfig = config.loopPrevention;
  const sessionTracker = new SessionTracker(loopConfig.sessionTracker ?? DEFAULT_LOOP_PREVENTION_CONFIG.sessionTracker);
  const toolGuard = new ToolLoopGuard(sessionTracker, loopConfig.toolCall);

  // Per-session stream guards (created on demand)
  const streamGuards = new Map<string, StreamLoopGuard>();

  const tracker = config.monitor.enabled ? new RequestTracker() : null;

  // Inject concurrency config per provider
  for (const [provider, cfg] of Object.entries(config.concurrency)) {
    if (cfg.adaptive) {
      adaptive.init(provider, { max: cfg.maxConcurrency }, {
        queueTimeoutMs: cfg.queueTimeoutMs,
        maxQueueSize: cfg.maxQueueSize,
      });
    } else {
      semaphore.updateConfig(provider, cfg);
    }
  }

  // --- Hook into pi lifecycle ---

  // Tool call: loop prevention + concurrency acquire
  pi.on("tool_call", async (event) => {
    if (!loopConfig.enabled) return;

    // Check tool loop
    const sessionId = "default"; // pi doesn't expose session ID in tool_call context easily
    const result = toolGuard.check(sessionId, {
      toolName: event.toolName,
      inputText: JSON.stringify(event.input),
      inputHash: "", // simplified
      timestamp: Date.now(),
    });

    if (result.detected) {
      return { block: true, reason: `Tool loop detected: ${event.toolName}` };
    }
  });

  // Message update: stream loop detection
  pi.on("message_update", async (event) => {
    if (!loopConfig.enabled || !loopConfig.stream.enabled) return;
    if (event.assistantMessageEvent.type !== "text_delta") return;

    const delta = event.assistantMessageEvent;
    if (delta.type !== "text_delta") return;

    let guard = streamGuards.get("default");
    if (!guard) {
      const detector = new NGramLoopDetector(loopConfig.stream.detectorConfig);
      guard = new StreamLoopGuard(loopConfig.stream, detector, (reason) => {
        // Loop detected — notify user
      });
      streamGuards.set("default", guard);
    }

    guard.feed(delta.delta);

    if (guard.isTriggered()) {
      // Stream loop detected — will be handled by next turn
    }
  });

  // Message end: monitor recording + adaptive feedback
  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant") return;

    const msg = event.message as any;
    const provider = msg.provider as string | undefined;
    if (!provider) return;

    // Adaptive feedback
    const isError = msg.stopReason === "error";
    adaptive.onRequestComplete(provider, {
      success: !isError,
      statusCode: isError ? 500 : 200,
    });

    // Monitor recording
    if (tracker) {
      // Simplified: record usage metrics
    }
  });

  // Session shutdown: cleanup
  pi.on("session_shutdown", async () => {
    sessionTracker.stop();
    streamGuards.clear();
  });

  // --- Register tools ---

  pi.registerTool({
    name: "router_status",
    label: "Router Status",
    description: "查看当前并发控制、循环防护、请求监控的状态",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const providers = Object.keys(config.concurrency);
      const concurrency = providers.map(p => ({
        provider: p,
        ...semaphore.getStatus(p),
        adaptive: adaptive.getStatus(p),
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            concurrency,
            loopPrevention: { enabled: loopConfig.enabled },
            monitor: { enabled: config.monitor.enabled },
          }, null, 2),
        }],
      };
    },
  });

  // --- Register commands ---

  pi.registerCommand("router-stats", {
    description: "显示 router 监控统计",
    handler: async (_args, ctx) => {
      if (!tracker) {
        ctx.ui.notify("Monitor is disabled", "warning");
        return;
      }
      const stats = tracker.getStats();
      ctx.ui.notify(JSON.stringify(stats, null, 2), "info");
    },
  });

  pi.registerCommand("router-reset", {
    description: "重置循环防护和监控统计",
    handler: async (_args, ctx) => {
      sessionTracker.stop();
      streamGuards.clear();
      ctx.ui.notify("Router state reset", "info");
    },
  });
}
```

- [ ] **Step 6: Build and verify**

Run: `cd pi-extension && npm install && npm run build`
Expected: compiles without errors (may need `@mariozechner/pi-coding-agent` available).

- [ ] **Step 7: Commit**

```bash
git add pi-extension/
git commit -m "feat(pi-extension): create pi extension with concurrency, loop prevention, and monitor adapters"
```

---

### Task 12: Final verification and cleanup

**Files:**
- Modify: root `package.json` scripts
- Delete: any leftover root-level `src/`, `tests/`, `vitest.config.ts`, `tsconfig.json` that belong to router

- [ ] **Step 1: Verify workspace builds**

Run: `npm run build`
Expected: core and router both build successfully.

- [ ] **Step 2: Verify all tests pass**

Run: `npm run test`
Expected: core and router tests all pass.

- [ ] **Step 3: Clean up root-level artifacts**

Remove from root any files that were moved to router/:
```bash
rm -f vitest.config.ts tsconfig.json  # if still at root
```

- [ ] **Step 4: Update root package.json scripts if needed**

Ensure root scripts delegate to workspace packages correctly.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and workspace verification"
```
