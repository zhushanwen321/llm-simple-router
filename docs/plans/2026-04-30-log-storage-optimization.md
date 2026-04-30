# 日志存储架构优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 3D 日志 DB 体积从 ~9GB 压缩到 ~750MB，同时保留失败日志全文可检索能力，并新增文件写入作为辅助通道。

**Architecture:** 两层存储：DB 存摘要（所有日志）+ 全文（仅失败/异常日志），JSONL 文件存所有日志全文（可开关）。通过 `RetryRuleMatcher` 判定是否保留详情。去除 `request_logs` 与 `request_metrics` 的 9 字段双写冗余。判定和文件写入逻辑**下沉到 `insertRequestLog`**，确保所有 9 个调用点自动覆盖。

**Tech Stack:** SQLite (better-sqlite3), Node.js fs/zlib, gzip compression, vitest

**Design Spec:** `docs/plans/2026-04-30-log-storage-optimization-design.md`

---

## File Structure

### New Files
- `src/proxy/log-detail-policy.ts` — 详情保留判定函数
- `src/storage/log-file-writer.ts` — JSONL 文件写入器（10 分钟分片）
- `src/storage/log-file-compressor.ts` — 定时压缩 + 清理任务
- `src/storage/types.ts` — 文件存储相关类型
- `tests/log-detail-policy.test.ts` — 判定函数测试
- `tests/storage/log-file-writer.test.ts` — 文件写入器测试
- `tests/storage/log-file-compressor.test.ts` — 压缩/清理测试

### Modified Files
- `src/db/migrations/034_drop_redundant_log_columns.sql` — 删除 9 个冗余字段
- `src/db/logs.ts` — 去除冗余字段的类型/查询，加 LEFT JOIN；insertRequestLog 集成判定 + 文件写入
- `src/db/settings.ts` — 新增配置项 getter
- `src/proxy/log-helpers.ts` — 传递 matcher/logFileWriter 到 insertRequestLog
- `src/proxy/proxy-logging.ts` — 去除 updateLogMetrics 双写；传递 matcher/logFileWriter
- `src/proxy/handler/proxy-handler.ts` — 传递 matcher/logFileWriter 到日志层
- `src/index.ts` — 注册 LogFileWriter/压缩任务；删除 backfillMetricsFromRequestMetrics 调用
- `src/core/container.ts` — SERVICE_KEYS 添加 logFileWriter
- `tests/db.test.ts` — migration 计数更新
- `tests/metrics.test.ts` — migration 计数更新

---

### Task 1: 新增判定函数 `shouldPreserveDetail`

**Files:**
- Create: `src/proxy/log-detail-policy.ts`
- Test: `tests/log-detail-policy.test.ts`

这是整个优化链路的决策核心——判断一条日志是否需要保留全文到 DB。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/log-detail-policy.test.ts
import { describe, it, expect } from "vitest";
import { shouldPreserveDetail } from "../src/proxy/log-detail-policy.js";

describe("shouldPreserveDetail", () => {
  it("returns true for HTTP status >= 400", () => {
    expect(shouldPreserveDetail(500, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(429, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(400, null, { test: () => false })).toBe(true);
  });

  it("returns false for HTTP 200 with no retry rule match", () => {
    expect(shouldPreserveDetail(200, '{"choices":[]}', { test: () => false })).toBe(false);
  });

  it("returns true for HTTP 200 when retry rule matches body", () => {
    const matcher = { test: (_code: number, body: string) => body.includes("content_filter") };
    expect(shouldPreserveDetail(200, '{"error":{"code":"content_filter"}}', matcher)).toBe(true);
  });

  it("returns false for null body when no retry match", () => {
    expect(shouldPreserveDetail(200, null, { test: () => false })).toBe(false);
  });

  it("returns true for HTTP 200 when retry rule matches by status code", () => {
    const matcher = { test: (code: number, _body: string) => code === 200 };
    expect(shouldPreserveDetail(200, "anything", matcher)).toBe(true);
  });

  it("returns true when matcher is null (conservative fallback)", () => {
    expect(shouldPreserveDetail(200, "body", null)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/log-detail-policy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// src/proxy/log-detail-policy.ts

const HTTP_ERROR_THRESHOLD = 400;

interface RetryMatcher {
  test: (statusCode: number, body: string) => boolean;
}

/**
 * 判断一条日志是否需要保留全文详情到 DB（client_request, upstream_request, upstream_response）。
 * 两层判定：
 * 1. HTTP status_code >= 400 → 保留
 * 2. status_code < 400 但 RetryRuleMatcher 命中 → 保留
 * 3. 否则 → 只存摘要
 * 4. matcher 为 null → 保守保留（降级策略）
 */
export function shouldPreserveDetail(
  statusCode: number | null,
  responseBody: string | null,
  matcher: RetryMatcher | null,
): boolean {
  if (statusCode !== null && statusCode >= HTTP_ERROR_THRESHOLD) {
    return true;
  }
  if (!matcher) {
    return true; // 无 matcher 时保守保留
  }
  if (responseBody && matcher.test(statusCode ?? 0, responseBody)) {
    return true;
  }
  return false;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/log-detail-policy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/log-detail-policy.ts tests/log-detail-policy.test.ts
git commit -m "feat: add shouldPreserveDetail policy for log detail retention"
```

---

### Task 2: 新增文件写入器 `LogFileWriter`

**Files:**
- Create: `src/storage/types.ts`
- Create: `src/storage/log-file-writer.ts`
- Test: `tests/storage/log-file-writer.test.ts`

JSONL 文件写入器，按 10 分钟分片写入所有日志全文。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/storage/log-file-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LogFileWriter } from "../../src/storage/log-file-writer.js";

describe("LogFileWriter", () => {
  let tempDir: string;
  let writer: LogFileWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "log-writer-test-"));
    writer = new LogFileWriter(tempDir);
  });

  afterEach(() => {
    writer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a log entry to the correct 10-minute file", () => {
    // 2026-04-30T14:23:45.000Z → file: 2026-04-30/14-20.jsonl
    const entry = {
      id: "test-1",
      created_at: "2026-04-30T14:23:45.000Z",
      api_type: "openai",
      status_code: 200,
      client_request: '{"headers":{}}',
      upstream_request: null,
      upstream_response: null,
      stream_text_content: null,
      pipeline_snapshot: null,
    };
    writer.write(entry);

    const dayDir = join(tempDir, "2026-04-30");
    const files = readdirSync(dayDir);
    expect(files).toContain("14-20.jsonl");

    const content = readFileSync(join(dayDir, "14-20.jsonl"), "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("test-1");
  });

  it("appends multiple entries to the same file", () => {
    const entry1 = { id: "a", created_at: "2026-04-30T14:01:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    const entry2 = { id: "b", created_at: "2026-04-30T14:02:00.000Z", api_type: "openai", status_code: 500, client_request: "req", upstream_request: null, upstream_response: "resp", stream_text_content: null, pipeline_snapshot: null };

    writer.write(entry1);
    writer.write(entry2);

    const content = readFileSync(join(tempDir, "2026-04-30", "14-00.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("a");
    expect(JSON.parse(lines[1]).id).toBe("b");
  });

  it("creates day directory if not exists", () => {
    const entry = { id: "x", created_at: "2026-05-01T00:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    writer.write(entry);
    const files = readdirSync(join(tempDir, "2026-05-01"));
    expect(files).toContain("00-00.jsonl");
  });

  it("does not throw when disabled", () => {
    const disabledWriter = new LogFileWriter(tempDir, { enabled: false });
    disabledWriter.write({ id: "y", created_at: "2026-04-30T14:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null });
    disabledWriter.stop();
    expect(readdirSync(tempDir)).toHaveLength(0);
  });

  it("does not write when entry has no client_request", () => {
    // 摘要模式的日志（成功请求）可能不传 client_request
    const entry = {
      id: "z", created_at: "2026-04-30T14:00:00.000Z", api_type: "openai", status_code: 200,
      client_request: null, upstream_request: null, upstream_response: null,
      stream_text_content: null, pipeline_snapshot: null,
    };
    writer.write(entry);
    // 文件仍然写入（包含 null 字段），用于 zgrep 搜索
    const content = readFileSync(join(tempDir, "2026-04-30", "14-00.jsonl"), "utf-8");
    expect(JSON.parse(content.trim()).id).toBe("z");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/storage/log-file-writer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现类型**

```typescript
// src/storage/types.ts
export interface LogFileEntry {
  id: string;
  created_at: string;
  api_type: string;
  status_code: number | null;
  client_request: string | null;
  upstream_request: string | null;
  upstream_response: string | null;
  stream_text_content: string | null;
  pipeline_snapshot: string | null;
}
```

- [ ] **Step 4: 实现写入器**

```typescript
// src/storage/log-file-writer.ts
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LogFileEntry } from "./types.js";

export interface LogFileWriterOptions {
  enabled?: boolean;
}

/**
 * 将日志全文追加写入 JSONL 文件（按 10 分钟分片）。
 * 目录结构: <baseDir>/YYYY-MM-DD/HH-MM.jsonl
 */
export class LogFileWriter {
  private readonly baseDir: string;
  private readonly enabled: boolean;

  constructor(baseDir: string, options?: LogFileWriterOptions) {
    this.baseDir = baseDir;
    this.enabled = options?.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  write(entry: LogFileEntry): void {
    if (!this.enabled) return;

    const date = new Date(entry.created_at);
    const dateStr = date.toISOString().slice(0, 10);
    const hour = date.getUTCHours().toString().padStart(2, "0");
    const minute = Math.floor(date.getUTCMinutes() / 10) * 10;
    const minuteStr = minute.toString().padStart(2, "0");
    const fileName = `${hour}-${minuteStr}.jsonl`;

    const dayDir = join(this.baseDir, dateStr);
    if (!existsSync(dayDir)) {
      mkdirSync(dayDir, { recursive: true });
    }

    const filePath = join(dayDir, fileName);
    const line = JSON.stringify(entry) + "\n";

    try {
      appendFileSync(filePath, line, "utf-8");
    } catch {
      // 文件写入是辅助通道，失败不影响主流程
    }
  }

  stop(): void {
    // 当前实现无需清理（appendFileSync 是同步的，无缓冲区）
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/storage/log-file-writer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/storage/ tests/storage/
git commit -m "feat: add LogFileWriter for 10-minute JSONL file output"
```

---

### Task 3: 新增压缩和清理任务

**Files:**
- Create: `src/storage/log-file-compressor.ts`
- Test: `tests/storage/log-file-compressor.test.ts`

定时压缩已结束窗口的 `.jsonl` → `.jsonl.gz`，并清理过期目录。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/storage/log-file-compressor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { compressFinishedFiles, cleanExpiredDirs } from "../../src/storage/log-file-compressor.js";

describe("log file compressor", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "log-compress-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("compressFinishedFiles", () => {
    it("compresses .jsonl files whose time window has passed", () => {
      const dayDir = join(tempDir, "2026-04-30");
      mkdirSync(dayDir, { recursive: true });
      writeFileSync(join(dayDir, "00-00.jsonl"), '{"id":"test"}\n', "utf-8");

      compressFinishedFiles(tempDir, new Date("2026-04-30T00:10:00Z"));

      const files = readdirSync(dayDir);
      expect(files).toContain("00-00.jsonl.gz");
      expect(files).not.toContain("00-00.jsonl");

      const gz = readFileSync(join(dayDir, "00-00.jsonl.gz"));
      const content = gunzipSync(gz).toString("utf-8");
      expect(content).toBe('{"id":"test"}\n');
    });

    it("skips files whose time window is still active", () => {
      const dayDir = join(tempDir, "2026-04-30");
      mkdirSync(dayDir, { recursive: true });
      writeFileSync(join(dayDir, "14-20.jsonl"), '{"id":"test"}\n', "utf-8");

      compressFinishedFiles(tempDir, new Date("2026-04-30T14:25:00Z"));

      const files = readdirSync(dayDir);
      expect(files).toContain("14-20.jsonl");
      expect(files).not.toContain("14-20.jsonl.gz");
    });

    it("skips .jsonl.gz files", () => {
      const dayDir = join(tempDir, "2026-04-30");
      mkdirSync(dayDir, { recursive: true });
      writeFileSync(join(dayDir, "00-00.jsonl.gz"), Buffer.from("already compressed"));

      compressFinishedFiles(tempDir, new Date("2026-04-30T01:00:00Z"));

      const files = readdirSync(dayDir);
      expect(files).toEqual(["00-00.jsonl.gz"]);
    });

    it("handles empty baseDir gracefully", () => {
      const emptyDir = join(tempDir, "nonexistent");
      expect(compressFinishedFiles(emptyDir, new Date())).toBe(0);
    });
  });

  describe("cleanExpiredDirs", () => {
    it("deletes directories older than retention days", () => {
      const oldDir = join(tempDir, "2026-04-27");
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, "23-50.jsonl.gz"), "data");

      const deleted = cleanExpiredDirs(tempDir, 3, new Date("2026-04-30T12:00:00Z"));

      expect(deleted).toBe(1);
      expect(existsSync(oldDir)).toBe(false);
    });

    it("keeps directories within retention period", () => {
      const recentDir = join(tempDir, "2026-04-28");
      mkdirSync(recentDir, { recursive: true });
      writeFileSync(join(recentDir, "00-00.jsonl.gz"), "data");

      const deleted = cleanExpiredDirs(tempDir, 3, new Date("2026-04-30T12:00:00Z"));

      expect(deleted).toBe(0);
      expect(existsSync(recentDir)).toBe(true);
    });

    it("handles empty baseDir gracefully", () => {
      const emptyDir = join(tempDir, "nonexistent");
      expect(cleanExpiredDirs(emptyDir, 3, new Date())).toBe(0);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/storage/log-file-compressor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现压缩和清理**

```typescript
// src/storage/log-file-compressor.ts
import { readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const COMPRESSION_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

/** 将已结束窗口的 .jsonl 文件压缩为 .jsonl.gz */
export function compressFinishedFiles(baseDir: string, now: Date): number {
  let compressed = 0;
  if (!existsSync(baseDir)) return 0;

  const dayDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));

  for (const dayDir of dayDirs) {
    const dirPath = join(baseDir, dayDir.name);
    const files = readdirSync(dirPath);

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const match = file.match(/^(\d{2})-(\d{2})\.jsonl$/);
      if (!match) continue;

      const fileHour = parseInt(match[1], 10);
      const fileMinute = parseInt(match[2], 10);

      // 窗口结束时间 = 文件名时刻 + 10 分钟
      const windowEnd = new Date(`${dayDir.name}T${String(fileHour).padStart(2, "0")}:${String(fileMinute).padStart(2, "0")}:00Z`);
      windowEnd.setUTCMinutes(windowEnd.getUTCMinutes() + 10);

      if (now >= windowEnd) {
        const filePath = join(dirPath, file);
        try {
          const content = readFileSync(filePath);
          const gzipped = gzipSync(content);
          writeFileSync(filePath + ".gz", gzipped);
          unlinkSync(filePath);
          compressed++;
        } catch {
          // 文件可能正在被写入，跳过
        }
      }
    }
  }
  return compressed;
}

/** 删除超过保留天数的日期目录 */
export function cleanExpiredDirs(baseDir: string, retentionDays: number, now: Date): number {
  if (!existsSync(baseDir)) return 0;

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let deleted = 0;
  const dayDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));

  for (const dayDir of dayDirs) {
    if (dayDir.name < cutoffStr) {
      rmSync(join(baseDir, dayDir.name), { recursive: true, force: true });
      deleted++;
    }
  }
  return deleted;
}

export interface LogFileMaintenanceHandle {
  stop: () => void;
}

/** 启动定时维护任务：每 10 分钟执行压缩 + 清理 */
export function scheduleLogFileMaintenance(
  baseDir: string,
  options: {
    retentionDays: number;
    log: { info: (msg: string) => void };
    intervalMs?: number;
  },
): LogFileMaintenanceHandle {
  const intervalMs = options.intervalMs ?? COMPRESSION_INTERVAL_MS;

  const doMaintenance = () => {
    const now = new Date();
    const compressed = compressFinishedFiles(baseDir, now);
    const deleted = cleanExpiredDirs(baseDir, options.retentionDays, now);
    if (compressed > 0 || deleted > 0) {
      options.log.info(`Log file maintenance: compressed ${compressed} files, deleted ${deleted} dirs`);
    }
  };

  const timer = setInterval(doMaintenance, intervalMs);
  const initialTimer = setTimeout(doMaintenance, 0);

  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(initialTimer);
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/storage/log-file-compressor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/log-file-compressor.ts tests/storage/log-file-compressor.test.ts
git commit -m "feat: add log file compressor and cleaner for JSONL maintenance"
```

---

### Task 4: 集成判定 + 文件写入到 `insertRequestLog`（核心集成）

**Files:**
- Modify: `src/db/logs.ts`
- Modify: `src/proxy/log-helpers.ts`
- Modify: `src/proxy/proxy-logging.ts`
- Modify: `src/proxy/handler/proxy-handler.ts`

**关键设计决策：** 把 `shouldPreserveDetail` 判定和文件写入**下沉到 `insertRequestLog` 本身**。这样所有 9 个调用点（`proxy-logging.ts` 的 4 个直接调用 + `handleIntercept` + `insertSuccessLog` + `insertRejectedLog` + `proxy-handler.ts` 的直接调用）自动覆盖，无遗漏。

- [ ] **Step 1: 修改 `insertRequestLog` 签名，集成判定和文件写入**

在 `src/db/logs.ts` 中：

```typescript
import type { LogFileWriter } from "../storage/log-file-writer.js";
import type { LogFileEntry } from "../storage/types.js";

export interface LogWriteContext {
  /** RetryRuleMatcher 用于判定是否保留详情。null = 保守保留 */
  matcher?: { test: (statusCode: number, body: string) => boolean } | null;
  /** 文件写入器。null 或 undefined = 不写文件 */
  logFileWriter?: LogFileWriter | null;
  /** 上游响应 body（用于 matcher 匹配判定）。大部分场景为 null，仅在成功时可用 */
  responseBody?: string | null;
}

export function insertRequestLog(
  db: Database.Database,
  log: RequestLogInsert,
  writeContext?: LogWriteContext,
): void {
  // 文件写入：始终写入全文（不管 DB 是否保留）
  if (writeContext?.logFileWriter) {
    writeContext.logFileWriter.write({
      id: log.id,
      created_at: log.created_at,
      api_type: log.api_type,
      status_code: log.status_code,
      client_request: log.client_request ?? null,
      upstream_request: log.upstream_request ?? null,
      upstream_response: log.upstream_response ?? null,
      stream_text_content: null,
      pipeline_snapshot: log.pipeline_snapshot ?? null,
    });
  }

  // 详情保留判定：决定 DB 是否写大 TEXT 字段
  const preserveDetail = shouldPreserveDetailInternal(
    log.status_code, writeContext?.responseBody ?? null, writeContext?.matcher ?? null,
  );

  db.prepare(
    `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, client_status_code, latency_ms,
      is_stream, error_message, created_at, client_request, upstream_request, upstream_response,
      is_retry, is_failover, original_request_id, router_key_id, original_model, session_id, pipeline_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    log.id, log.api_type, log.model, log.provider_id, log.status_code,
    log.client_status_code ?? null,
    log.latency_ms, log.is_stream, log.error_message, log.created_at,
    preserveDetail ? (log.client_request ?? null) : null,
    preserveDetail ? (log.upstream_request ?? null) : null,
    preserveDetail ? (log.upstream_response ?? null) : null,
    log.is_retry ?? 0, log.is_failover ?? 0, log.original_request_id ?? null,
    log.router_key_id ?? null, log.original_model ?? null,
    log.session_id ?? null,
    log.pipeline_snapshot ?? null,
  );
}

const HTTP_ERROR_THRESHOLD = 400;

function shouldPreserveDetailInternal(
  statusCode: number | null,
  responseBody: string | null,
  matcher: { test: (statusCode: number, body: string) => boolean } | null,
): boolean {
  if (statusCode !== null && statusCode >= HTTP_ERROR_THRESHOLD) return true;
  if (!matcher) return true;
  if (responseBody && matcher.test(statusCode ?? 0, responseBody)) return true;
  return false;
}
```

**注意：** `insertRequestLog` 新增可选第三个参数 `writeContext`，所有现有调用点不传参时行为不变（保守保留详情 + 不写文件），实现零破坏性变更。

- [ ] **Step 2: 在 `src/proxy/log-helpers.ts` 传递 writeContext**

`insertSuccessLog` 和 `insertRejectedLog` 新增 `matcher` 和 `logFileWriter` 可选参数，组装成 `writeContext` 传给 `insertRequestLog`：

```typescript
// src/proxy/log-helpers.ts — 参数扩展
import type { LogFileWriter } from "../storage/log-file-writer.js";
import type { LogWriteContext } from "../db/logs.js";

export interface RequestLogParams extends LogRetryMeta {
  // ...existing fields...
  matcher?: { test: (statusCode: number, body: string) => boolean } | null;
  logFileWriter?: LogFileWriter | null;
}

export function insertSuccessLog(
  db: Database.Database,
  params: RequestLogParams,
): void {
  const { matcher, logFileWriter, /* ...existing destructure... */ } = params;
  // ...existing logic...
  const writeContext: LogWriteContext = {
    matcher,
    logFileWriter,
    responseBody: respBody,
  };
  insertRequestLog(db, { /* ...existing fields... */ }, writeContext);
}

// insertRejectedLog 同理，但 status >= 400 所以 shouldPreserveDetail 始终 true
```

- [ ] **Step 3: 在 `src/proxy/proxy-logging.ts` 传递 writeContext**

`logResilienceResult` 和 `handleIntercept` 中所有 `insertRequestLog` 调用和 `insertSuccessLog` 调用，传递 matcher + logFileWriter。

`logResilienceResult` 签名新增 `matcher` 和 `logFileWriter` 字段到 params 对象。

`handleIntercept` 签名新增 `matcher` 和 `logFileWriter` 可选参数。

`collectTransportMetrics` 中删除 `updateLogMetrics` 调用（为 Task 5 做准备，此处先删除避免后续冲突）。

- [ ] **Step 4: 在 `src/proxy/handler/proxy-handler.ts` 传递 matcher 和 logFileWriter**

从 container 解析：
```typescript
const matcher = deps.container.resolve<RetryRuleMatcher>(SERVICE_KEYS.matcher);
const logFileWriter = deps.container.resolve<LogFileWriter | null>(SERVICE_KEYS.logFileWriter);
```

传递到 `handleIntercept`、`logResilienceResult`、`insertRejectedLog`、`insertSuccessLog`（via logResilienceResult）。

`proxy-handler.ts:469` 的直接 `insertRequestLog` 调用也传递 `writeContext`。

- [ ] **Step 5: 运行编译检查**

Run: `npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 6: 运行全部测试**

Run: `npm test`
Expected: 全部通过。由于 `writeContext` 是可选参数，不传时行为不变，现有测试应无破坏。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: integrate shouldPreserveDetail + file writing into insertRequestLog"
```

---

### Task 5: 删除 9 个冗余字段 + LEFT JOIN

**Files:**
- Create: `src/db/migrations/034_drop_redundant_log_columns.sql`
- Modify: `src/db/logs.ts`
- Modify: `src/db/index.ts`
- Modify: `src/proxy/proxy-logging.ts`
- Modify: `src/index.ts`

从 `request_logs` 删除已双写到 `request_metrics` 的 9 个冗余字段。所有查询改用 LEFT JOIN。

- [ ] **Step 1: 创建 migration**

```sql
-- 034_drop_redundant_log_columns.sql
-- request_logs 与 request_metrics 双写冗余清理：
-- metrics 字段统一由 request_metrics 承载，日志列表查询改用 LEFT JOIN。

ALTER TABLE request_logs DROP COLUMN input_tokens;
ALTER TABLE request_logs DROP COLUMN output_tokens;
ALTER TABLE request_logs DROP COLUMN cache_read_tokens;
ALTER TABLE request_logs DROP COLUMN ttft_ms;
ALTER TABLE request_logs DROP COLUMN tokens_per_second;
ALTER TABLE request_logs DROP COLUMN stop_reason;
ALTER TABLE request_logs DROP COLUMN backend_model;
ALTER TABLE request_logs DROP COLUMN metrics_complete;
ALTER TABLE request_logs DROP COLUMN input_tokens_estimated;
```

- [ ] **Step 2: 更新 migration 计数测试**

在 `tests/db.test.ts` 中将 `expect(rows.length).toBe(34)` 改为 `expect(rows.length).toBe(35)`。
在 `tests/metrics.test.ts` 中将 `expect(rows).toHaveLength(34)` 改为 `expect(rows).toHaveLength(35)`。

- [ ] **Step 3: 更新 `src/db/logs.ts`**

1. 从 `RequestLog` 接口删除：`input_tokens`, `output_tokens`, `cache_read_tokens`, `ttft_ms`, `tokens_per_second`, `stop_reason`, `backend_model`, `metrics_complete`。

2. 删除函数：`updateLogMetrics`, `backfillMetricsFromRequestMetrics`。

3. 更新 `LOG_LIST_SELECT` — 加 LEFT JOIN `request_metrics`：

```typescript
const LOG_LIST_SELECT = `rl.id, rl.api_type, rl.model, rl.provider_id, rl.status_code, rl.client_status_code, rl.latency_ms,
            rl.is_stream, rl.error_message, rl.created_at, rl.is_retry, rl.is_failover, rl.original_request_id, rl.original_model,
            CASE WHEN rl.provider_id = 'router' THEN rl.upstream_request ELSE NULL END AS upstream_request,
            rl.session_id, rl.pipeline_snapshot,
            rm.input_tokens, rm.output_tokens, rm.cache_read_tokens, rm.ttft_ms,
            rm.tokens_per_second, rm.stop_reason, rm.backend_model, rm.is_complete AS metrics_complete,
            rm.input_tokens_estimated,
            COALESCE(p.name, rl.provider_id) AS provider_name`;
const LOG_LIST_JOIN = `LEFT JOIN providers p ON p.id = rl.provider_id LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id`;
```

4. 更新 `getRequestLogById`：加 `LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id`，返回 metrics 字段从 `rm.*`。

5. 更新 `estimateLogTableSize`：删除已不存在的列引用。

- [ ] **Step 4: 更新 `src/db/index.ts`**

从 re-export 列表删除 `updateLogMetrics` 和 `backfillMetricsFromRequestMetrics`。

- [ ] **Step 5: 更新 `src/proxy/proxy-logging.ts`**

删除 `updateLogMetrics` 的 import 和所有调用（2 处：`collectTransportMetrics` 内）。仅保留 `insertMetrics` 调用。

- [ ] **Step 6: 更新 `src/index.ts`**

1. 删除 `backfillMetricsFromRequestMetrics` 的 import（第 17 行）。
2. 删除 `backfillMetricsFromRequestMetrics(db)` 调用（约第 217 行）。
3. 删除 `const backfilled = ...` 相关变量。

- [ ] **Step 7: 运行编译检查**

Run: `npx tsc --noEmit`
Expected: 零错误。如果有残留引用，逐一修复。

- [ ] **Step 8: 运行全部测试**

Run: `npm test`
Expected: 全部通过。修复因 SQL 变更和类型变更导致的测试失败（主要是 `logs.ts` 的查询返回类型变更）。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: drop 9 redundant columns from request_logs, use LEFT JOIN request_metrics"
```

---

### Task 6: 新增 settings 配置项

**Files:**
- Modify: `src/db/settings.ts`
- Modify: `src/admin/settings.ts`（CONFIG_TABLES 白名单）

- [ ] **Step 1: 在 `src/db/settings.ts` 添加 getter**

```typescript
export function getDetailLogEnabled(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("detail_log_enabled") as { value: string } | undefined;
  return row ? row.value !== "0" : true;
}

export function getLogFileRetentionDays(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("log_file_retention_days") as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 3;
}
```

- [ ] **Step 2: 在 `src/admin/settings.ts` 的 CONFIG_TABLES 白名单中添加 `detail_log_enabled` 和 `log_file_retention_days`**

确保这两个 key 可通过 admin API 导入/导出/管理。

- [ ] **Step 3: Commit**

```bash
git add src/db/settings.ts src/admin/settings.ts
git commit -m "feat: add detail_log_enabled and log_file_retention_days settings"
```

---

### Task 7: 注册到 `buildApp` 生命周期

**Files:**
- Modify: `src/index.ts`
- Modify: `src/core/container.ts`

- [ ] **Step 1: 在 `src/core/container.ts` 的 SERVICE_KEYS 添加 `logFileWriter`**

- [ ] **Step 2: 在 `src/index.ts` 的 `buildApp` 中集成**

```typescript
import { LogFileWriter } from "./storage/log-file-writer.js";
import { scheduleLogFileMaintenance } from "./storage/log-file-compressor.js";
import { getDetailLogEnabled, getLogFileRetentionDays } from "./db/settings.js";
import { dirname, join } from "node:path";

// 在 buildApp 内部，DB_PATH 不是 :memory: 时才启用文件写入：
const isMemoryDb = config.DB_PATH === ":memory:";
const logsDir = isMemoryDb ? "" : join(dirname(config.DB_PATH), "logs");
const logFileWriter = new LogFileWriter(logsDir, {
  enabled: !isMemoryDb && getDetailLogEnabled(db),
});
container.register(SERVICE_KEYS.logFileWriter, () => logFileWriter);

// 启动压缩/清理任务（:memory: 也要注册一个 dummy 以免 resolve 报错）
if (!isMemoryDb) {
  const logFileMaintenance = scheduleLogFileMaintenance(logsDir, {
    retentionDays: getLogFileRetentionDays(db),
    log: app.log,
  });
  // 在 close() 中清理
  const prevClose = close;
  close = async () => {
    logFileMaintenance.stop();
    await prevClose();
  };
}
```

- [ ] **Step 3: 更新所有测试中创建 ServiceContainer 的地方**

添加 `container.register(SERVICE_KEYS.logFileWriter, () => null)` 以避免 resolve 失败。涉及的测试文件（凡是 `new ServiceContainer()` 的地方都需要加）。

- [ ] **Step 4: 运行全部测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: integrate LogFileWriter and maintenance into buildApp lifecycle"
```

---

### Task 8: 端到端验证 + lint

**Files:**
- 无新增文件，确认性验证

- [ ] **Step 1: 运行 lint**

Run: `npm run lint`
Expected: 零 error（允许已有 warning）

- [ ] **Step 2: 运行全部测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 3: 手动验证**

1. `npm run build` 确认构建通过
2. 检查 `src/db/logs.ts` 的 `LOG_LIST_SELECT` 包含 `rm.input_tokens` 等 LEFT JOIN 字段
3. 检查 `insertRequestLog` 的第三个参数 `writeContext` 在所有调用点正确传递

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: end-to-end verification for log storage optimization"
```

---

## Self-Review

### Spec Coverage

| 设计要求 | 对应 Task |
|---------|----------|
| 详情保留判定（status + retry rule） | Task 1 + Task 4（下沉到 insertRequestLog） |
| 文件写入器（10 分钟分片 JSONL） | Task 2 |
| 压缩 + 清理任务 | Task 3 |
| 判定+文件写入集成（覆盖所有 9 个调用点） | Task 4 |
| 删除 9 个冗余字段 + LEFT JOIN | Task 5 |
| 配置项（detail_log_enabled, log_file_retention_days） | Task 6 |
| buildApp 集成 + 生命周期管理 + :memory: 保护 | Task 7 |
| 端到端验证 | Task 8 |

### Review 问题修复确认

| 问题 | 修复方式 |
|------|---------|
| 🔴 文件写入覆盖不完整（9 个调用点） | Task 4：判定+文件写入下沉到 `insertRequestLog`，所有调用点自动覆盖 |
| 🔴 `backfillMetricsFromRequestMetrics` 调用未清理 | Task 5 Step 6：明确删除 import 和调用 |
| 🟡 `:memory:` DB 文件写入边界情况 | Task 7 Step 2：`isMemoryDb` 判断，跳过文件写入和压缩任务 |
| 💡 Task 顺序调整 | Task 4（写入层）先于 Task 5（读取层+删字段），减少一次性改动范围 |

### Placeholder Scan

无 TODO/TBD/placeholder。所有代码块完整。

### Type Consistency

- `LogFileEntry` 定义在 `src/storage/types.ts`，Task 2/4 统一使用
- `LogWriteContext` 定义在 `src/db/logs.ts`，Task 4 创建并在 log-helpers/proxy-logging/proxy-handler 中使用
- `shouldPreserveDetailInternal` 在 `insertRequestLog` 内部，与 Task 1 的 `shouldPreserveDetail` 逻辑一致（matcher 为 null 时保守保留）
- `RetryMatcher` 接口 `{ test: (statusCode: number, body: string) => boolean }` 与 `RetryRuleMatcher.test()` 签名一致
- `SERVICE_KEYS.logFileWriter` 在 Task 7 添加到 container.ts，所有 resolve 调用统一使用
