import type { LoopDetector } from "./detector.js";
import type { StreamLoopGuardConfig } from "./types.js";

export class StreamLoopGuard {
  private triggered = false;

  constructor(
    private readonly config: StreamLoopGuardConfig,
    private readonly detector: LoopDetector,
    private readonly onLoopDetected: (reason: string) => void,
  ) {}

  feed(text: string): void {
    if (this.triggered) return;
    if (!this.config.enabled) return;
    if (this.detector.feed(text)) {
      this.triggered = true;
      this.onLoopDetected(this.detector.getStatus().reason ?? "stream_content_loop");
    }
  }

  isTriggered(): boolean {
    return this.triggered;
  }

  reset(): void {
    this.triggered = false;
    this.detector.reset();
  }
}
