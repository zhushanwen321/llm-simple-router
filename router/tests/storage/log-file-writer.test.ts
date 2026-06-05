import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { LogFileWriter } from "../../src/storage/log-file-writer.js";

/** 等待异步写入完成 */
const WAIT_MS = 200;
const waitWrite = () => new Promise<void>(r => setTimeout(r, WAIT_MS));

describe("LogFileWriter", () => {
  let tempDir: string;
  let writer: LogFileWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "log-writer-test-"));
    writer = new LogFileWriter(tempDir);
  });

  afterEach(async () => {
    await writer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a log entry to {date}/{HH}/{id}.json", async () => {
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
    await waitWrite();

    const filePath = join(tempDir, "2026-04-30", "14", "test-1.json");
    expect(existsSync(filePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(parsed.id).toBe("test-1");
  });

  it("writes multiple entries to the same hour directory", async () => {
    const entry1 = { id: "a", created_at: "2026-04-30T14:01:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    const entry2 = { id: "b", created_at: "2026-04-30T14:59:00.000Z", api_type: "openai", status_code: 500, client_request: "req", upstream_request: null, upstream_response: "resp", stream_text_content: null, pipeline_snapshot: null };

    writer.write(entry1);
    writer.write(entry2);
    await waitWrite();

    const hourDir = join(tempDir, "2026-04-30", "14");
    const files = readdirSync(hourDir);
    expect(files).toContain("a.json");
    expect(files).toContain("b.json");
  });

  it("creates date/hour directory if not exists", async () => {
    const entry = { id: "x", created_at: "2026-05-01T00:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    writer.write(entry);
    await waitWrite();

    const hourDir = join(tempDir, "2026-05-01", "00");
    expect(existsSync(hourDir)).toBe(true);
    const files = readdirSync(hourDir);
    expect(files).toContain("x.json");
  });

  it("does not throw when disabled", () => {
    const disabledWriter = new LogFileWriter(tempDir, { enabled: false });
    disabledWriter.write({ id: "y", created_at: "2026-04-30T14:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null });
    disabledWriter.stop();
    expect(readdirSync(tempDir)).toHaveLength(0);
  });

  it("reads entry by id from single JSON file", async () => {
    const entry = {
      id: "read-1",
      created_at: "2026-04-30T14:23:45.000Z",
      api_type: "openai",
      status_code: 200,
      client_request: '{"body":{}}',
      upstream_request: null,
      upstream_response: null,
      stream_text_content: null,
      pipeline_snapshot: null,
    };
    writer.write(entry);
    await waitWrite();

    const result = writer.read("read-1", "2026-04-30T14:23:45.000Z");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("read-1");
  });

  it("reads entry from compressed single JSON file", async () => {
    const entry = { id: "gz-1", created_at: "2026-04-30T14:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    // 手动写入压缩文件
    const dir = join(tempDir, "2026-04-30", "14");
    await mkdir(dir, { recursive: true });
    fsWriteFileSync(join(dir, "gz-1.json.gz"), gzipSync(Buffer.from(JSON.stringify(entry))));

    const result = writer.read("gz-1", "2026-04-30T14:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("gz-1");
  });

  it("falls back to legacy JSONL format for reading", async () => {
    // 手动创建旧格式 JSONL 文件
    const entry = { id: "legacy-1", created_at: "2026-04-30T14:05:00.000Z", api_type: "openai", status_code: 200, client_request: "legacy-req", upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    const dayDir = join(tempDir, "2026-04-30");
    await mkdir(dayDir, { recursive: true });
    fsWriteFileSync(join(dayDir, "14-00.jsonl"), JSON.stringify(entry) + "\n");

    const result = writer.read("legacy-1", "2026-04-30T14:05:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("legacy-1");
    expect(result!.client_request).toBe("legacy-req");
  });

  it("falls back to legacy compressed JSONL for reading", async () => {
    const entry = { id: "legacy-gz-1", created_at: "2026-04-30T14:05:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    const dayDir = join(tempDir, "2026-04-30");
    await mkdir(dayDir, { recursive: true });
    fsWriteFileSync(join(dayDir, "14-00.jsonl.gz"), gzipSync(Buffer.from(JSON.stringify(entry) + "\n")));

    const result = writer.read("legacy-gz-1", "2026-04-30T14:05:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("legacy-gz-1");
  });

  it("returns null when entry not found", () => {
    const result = writer.read("nonexistent", "2026-04-30T14:00:00.000Z");
    expect(result).toBeNull();
  });
});

