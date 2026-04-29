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

/* eslint-disable no-magic-numbers -- DEFAULT 配置值本身就是语义化命名 */
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
