import type { ILogSink } from "../../core/log-sink.js";

export class InMemoryLogSink implements ILogSink {
  public logs: Record<string, unknown>[] = [];
  public metrics: Record<string, unknown>[] = [];
  public streamContent: Map<string, string> = new Map();
  public clientStatuses: Map<string, number> = new Map();

  insertRequestLog(log: Record<string, unknown>): void {
    this.logs.push({ ...log });
  }

  insertMetrics(metrics: Record<string, unknown>): void {
    this.metrics.push({ ...metrics });
  }

  updateLogStreamContent(logId: string, textContent: string): void {
    this.streamContent.set(logId, textContent);
  }

  updateLogClientStatus(logId: string, clientStatusCode: number): void {
    this.clientStatuses.set(logId, clientStatusCode);
  }

  reset(): void {
    this.logs = [];
    this.metrics = [];
    this.streamContent.clear();
    this.clientStatuses.clear();
  }
}
