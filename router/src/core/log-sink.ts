/**
 * ILogSink — 日志持久化 seam。
 *
 * proxy 层通过此接口写入日志，不直接依赖 DB。
 * 生产环境由 DbLogSink 实现，测试环境由 InMemoryLogSink 实现。
 */

export interface ILogSink {
  insertRequestLog(log: Record<string, unknown>): void;
  insertMetrics(metrics: Record<string, unknown>): void;
  updateLogStreamContent(logId: string, textContent: string): void;
  updateLogClientStatus(logId: string, clientStatusCode: number): void;
}
