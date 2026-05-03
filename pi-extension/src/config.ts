import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConcurrencyConfig, LoopPreventionConfig } from "@llm-router/core";

export interface ProviderConcurrencyEntry extends ConcurrencyConfig {
  adaptive: boolean;
}

export interface ExtensionConfig {
  concurrency: Record<string, ProviderConcurrencyEntry>;
  loopPrevention: LoopPreventionConfig;
  monitor: {
    enabled: boolean;
    statsIntervalMs: number;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadConfig(): ExtensionConfig {
  const configPath = join(__dirname, "..", "config.json");

  if (!existsSync(configPath)) {
    return defaultConfig();
  }

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as ExtensionConfig;
}

function defaultConfig(): ExtensionConfig {
  return {
    concurrency: {},
    loopPrevention: {
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
    },
    monitor: { enabled: true, statsIntervalMs: 60_000 },
  };
}
