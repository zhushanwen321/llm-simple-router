import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  PORT: number;
  DB_PATH: string;
  LOG_LEVEL: string;
  TZ: string;
  STREAM_TIMEOUT_MS: number;
  RETRY_BASE_DELAY_MS: number;
}

let cachedConfig: Config | null = null;

function getDefaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return join(homedir(), ".llm-simple-router", "router.db");
}

export function resetConfig(): void {
  cachedConfig = null;
}

export function getBaseConfig(): Config {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    PORT: parseInt(process.env.PORT || "9981", 10),
    DB_PATH: getDefaultDbPath(),
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    TZ: process.env.TZ || "Asia/Shanghai",
    STREAM_TIMEOUT_MS: parseInt(process.env.STREAM_TIMEOUT_MS || "3000000", 10),
    RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || "1000", 10),
  };
  return cachedConfig;
}

/** @deprecated Use getBaseConfig directly */
export function getConfig(): Config {
  return getBaseConfig();
}
