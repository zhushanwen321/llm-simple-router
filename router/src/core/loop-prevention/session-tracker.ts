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
      // If TTL expired, clear tool call history (session stays in active map)
      if (Date.now() - session.lastAccessTime > this.config.sessionTtlMs) {
        session.toolCalls = [];
      }
      session.lastAccessTime = Date.now();
    }
    // 同一 tool_use 不重复记录（模型切换、重试等场景会复用历史）
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
