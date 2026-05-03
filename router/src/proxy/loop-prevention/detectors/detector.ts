export interface LoopDetectorStatus {
  detected: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface LoopDetector {
  feed(text: string): boolean;
  reset(): void;
  getStatus(): LoopDetectorStatus;
}
