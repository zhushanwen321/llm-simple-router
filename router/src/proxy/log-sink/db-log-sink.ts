import Database from "better-sqlite3";
import type { ILogSink } from "../../core/log-sink.js";
import { insertRequestLog, updateLogStreamContent, updateLogClientStatus } from "../../db/logs.js";
import { insertMetrics } from "../../db/metrics.js";

export class DbLogSink implements ILogSink {
  constructor(private db: Database.Database) {}

  insertRequestLog(log: Record<string, unknown>): void {
    insertRequestLog(this.db, log as unknown as Parameters<typeof insertRequestLog>[1]);
  }

  insertMetrics(metrics: Record<string, unknown>): void {
    insertMetrics(this.db, metrics as unknown as Parameters<typeof insertMetrics>[1]);
  }

  updateLogStreamContent(logId: string, textContent: string): void {
    updateLogStreamContent(this.db, logId, textContent);
  }

  updateLogClientStatus(logId: string, clientStatusCode: number): void {
    updateLogClientStatus(this.db, logId, clientStatusCode);
  }
}
