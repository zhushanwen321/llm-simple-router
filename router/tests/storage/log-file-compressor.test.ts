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
