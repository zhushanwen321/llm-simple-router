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

  afterEach(async () => {
    await writer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a log entry to the correct 10-minute file", async () => {
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
    await writer.stop();

    const dayDir = join(tempDir, "2026-04-30");
    const files = readdirSync(dayDir);
    expect(files).toContain("14-20.jsonl");

    const content = readFileSync(join(dayDir, "14-20.jsonl"), "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("test-1");
  });

  it("appends multiple entries to the same file", async () => {
    const entry1 = { id: "a", created_at: "2026-04-30T14:01:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    const entry2 = { id: "b", created_at: "2026-04-30T14:02:00.000Z", api_type: "openai", status_code: 500, client_request: "req", upstream_request: null, upstream_response: "resp", stream_text_content: null, pipeline_snapshot: null };

    writer.write(entry1);
    writer.write(entry2);
    await writer.stop();

    const content = readFileSync(join(tempDir, "2026-04-30", "14-00.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("a");
    expect(JSON.parse(lines[1]).id).toBe("b");
  });

  it("creates day directory if not exists", async () => {
    const entry = { id: "x", created_at: "2026-05-01T00:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null };
    writer.write(entry);
    await writer.stop();
    const files = readdirSync(join(tempDir, "2026-05-01"));
    expect(files).toContain("00-00.jsonl");
  });

  it("does not throw when disabled", () => {
    const disabledWriter = new LogFileWriter(tempDir, { enabled: false });
    disabledWriter.write({ id: "y", created_at: "2026-04-30T14:00:00.000Z", api_type: "openai", status_code: 200, client_request: null, upstream_request: null, upstream_response: null, stream_text_content: null, pipeline_snapshot: null });
    disabledWriter.stop();
    expect(readdirSync(tempDir)).toHaveLength(0);
  });
});
