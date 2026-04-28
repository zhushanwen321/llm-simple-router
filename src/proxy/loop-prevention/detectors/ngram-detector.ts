import type { LoopDetector, LoopDetectorStatus } from "./detector.js";
import type { NGramDetectorConfig } from "../types.js";

export class NGramLoopDetector implements LoopDetector {
  private window: string[] = [];
  private ngramCounts = new Map<string, number>();
  private detected = false;
  private maxPeakCount = 0;
  private peakNgram = "";
  private totalCharsProcessed = 0;

  constructor(private readonly config: NGramDetectorConfig) {}

  feed(text: string): boolean {
    if (this.detected) return true;
    for (const char of text) {
      this.window.push(char);
      this.totalCharsProcessed++;
      if (this.window.length >= this.config.n) {
        const ngram = this.window.slice(-this.config.n).join("");
        const count = (this.ngramCounts.get(ngram) ?? 0) + 1;
        this.ngramCounts.set(ngram, count);
        if (count > this.maxPeakCount) {
          this.maxPeakCount = count;
          this.peakNgram = ngram;
        }
      }
      if (this.window.length > this.config.windowSize) {
        const leaving = this.window.slice(0, this.config.n).join("");
        this.window.shift();
        if (this.window.length >= this.config.n) {
          const c = this.ngramCounts.get(leaving);
          if (c && c > 1) this.ngramCounts.set(leaving, c - 1);
          else this.ngramCounts.delete(leaving);
        }
      }
    }
    if (this.maxPeakCount >= this.config.repeatThreshold) {
      this.detected = true;
    }
    return this.detected;
  }

  reset(): void {
    this.window = [];
    this.ngramCounts.clear();
    this.detected = false;
    this.maxPeakCount = 0;
    this.peakNgram = "";
    this.totalCharsProcessed = 0;
  }

  getStatus(): LoopDetectorStatus {
    return {
      detected: this.detected,
      reason: this.detected ? `NGram '${this.peakNgram}' repeated ${this.maxPeakCount} times` : undefined,
      details: {
        peakNgram: this.peakNgram,
        peakCount: this.maxPeakCount,
        threshold: this.config.repeatThreshold,
        totalChars: this.totalCharsProcessed,
        windowSize: this.window.length,
      },
    };
  }
}
