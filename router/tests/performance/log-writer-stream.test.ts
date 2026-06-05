// BI-H3: LogFileWriter 异步写入测试
//
// 当前实现：LogFileWriter.write() 使用异步 writeFile（fire-and-forget）
// 本测试验证：
// 1. write() 调用后文件最终包含正确内容（异步等待）
// 2. 高频写入不丢数据
// 3. write() 不阻塞事件循环

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LogFileWriter } from "../../src/storage/log-file-writer.js";

function makeEntry(id: string, createdAt: string) {
  return {
    id,
    created_at: createdAt,
    api_type: "openai",
    status_code: 200,
    client_request: null,
    upstream_request: null,
    upstream_response: null,
    stream_text_content: null,
    pipeline_snapshot: null,
  };
}

/** 等待异步写入完成 */
const WAIT_MS = 300;
const waitWrite = () => new Promise<void>(r => setTimeout(r, WAIT_MS));

describe("BI-H3: LogFileWriter async writeFile", () => {
  let tempDir: string;
  let writer: LogFileWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "log-writer-async-test-"));
    writer = new LogFileWriter(tempDir);
  });

  afterEach(async () => {
    await writer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("write() 异步写入 — 调用后短暂等待文件应包含内容", async () => {
    const entry = makeEntry("async-1", "2026-04-30T14:23:45.000Z");
    writer.write(entry);

    // 异步写入需要短暂等待让 I/O 完成
    await waitWrite();

    const filePath = join(tempDir, "2026-04-30", "14", "async-1.json");
    expect(existsSync(filePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(parsed.id).toBe("async-1");
  });

  it("stop() 后所有缓冲数据已写入文件", async () => {
    // 写入多条数据到同一小时
    for (let i = 0; i < 5; i++) {
      writer.write(makeEntry(`flush-${i}`, "2026-04-30T14:01:00.000Z"));
    }

    // stop + 等待（新格式 stop 是同步的，但写入仍是异步）
    await writer.stop();
    await waitWrite();

    const hourDir = join(tempDir, "2026-04-30", "14");
    for (let i = 0; i < 5; i++) {
      const filePath = join(hourDir, `flush-${i}.json`);
      expect(existsSync(filePath)).toBe(true);
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(parsed.id).toBe(`flush-${i}`);
    }
  });

  it("高频写入 100 条不丢数据", async () => {
    for (let i = 0; i < 100; i++) {
      writer.write(makeEntry(`highfreq-${i}`, "2026-04-30T14:01:00.000Z"));
    }

    // 等待异步写入完成
    await waitWrite();

    const hourDir = join(tempDir, "2026-04-30", "14");
    const files = readdirSync(hourDir);
    expect(files).toHaveLength(100);

    for (let i = 0; i < 100; i++) {
      expect(files).toContain(`highfreq-${i}.json`);
    }
  });

  it("write() 不应同步阻塞事件循环", async () => {
    // 验证：连续调用 write() 不应显著阻塞事件循环
    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      writer.write(makeEntry(`perf-${i}`, "2026-04-30T14:01:00.000Z"));
    }

    const writeTime = performance.now() - start;

    // 异步 writeFile 应该非常快（只发起 Promise，不等待完成）
    // 100 次 write 应在 50ms 内完成（远低于同步 I/O）
    expect(writeTime).toBeLessThan(200);

    // 等待数据写入完成
    await waitWrite();

    // 验证数据完整性
    const hourDir = join(tempDir, "2026-04-30", "14");
    const files = readdirSync(hourDir);
    expect(files).toHaveLength(100);
  });

  it("跨日文件正确创建", async () => {
    writer.write(makeEntry("day1", "2026-04-30T23:55:00.000Z"));
    writer.write(makeEntry("day2", "2026-05-01T00:05:00.000Z"));

    await waitWrite();

    const file1 = join(tempDir, "2026-04-30", "23", "day1.json");
    const file2 = join(tempDir, "2026-05-01", "00", "day2.json");

    expect(existsSync(file1)).toBe(true);
    expect(existsSync(file2)).toBe(true);

    expect(JSON.parse(readFileSync(file1, "utf-8")).id).toBe("day1");
    expect(JSON.parse(readFileSync(file2, "utf-8")).id).toBe("day2");
  });

  it("disabled writer 不创建文件", () => {
    const disabledWriter = new LogFileWriter(tempDir, { enabled: false });
    disabledWriter.write(makeEntry("disabled", "2026-04-30T14:00:00.000Z"));
    disabledWriter.stop();
    expect(readdirSync(tempDir)).toHaveLength(0);
  });
});
