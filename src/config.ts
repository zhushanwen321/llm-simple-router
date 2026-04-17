import "dotenv/config";

export interface Config {
  ADMIN_PASSWORD: string;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  PORT: number;
  DB_PATH: string;
  LOG_LEVEL: string;
  TZ: string;
  STREAM_TIMEOUT_MS: number;
  RETRY_MAX_ATTEMPTS: number;
  RETRY_BASE_DELAY_MS: number;
}

let cachedConfig: Config | null = null;

export function resetConfig(): void {
  cachedConfig = null;
}

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const requiredVars = ["ADMIN_PASSWORD", "ENCRYPTION_KEY", "JWT_SECRET"];
  for (const name of requiredVars) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  cachedConfig = {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
    JWT_SECRET: process.env.JWT_SECRET!,
    PORT: parseInt(process.env.PORT || "3000", 10),
    DB_PATH: process.env.DB_PATH || "./data/router.db",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    TZ: process.env.TZ || "Asia/Shanghai",
    STREAM_TIMEOUT_MS: parseInt(process.env.STREAM_TIMEOUT_MS || "3000000", 10),
    RETRY_MAX_ATTEMPTS: parseInt(process.env.RETRY_MAX_ATTEMPTS || "3", 10),
    RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || "1000", 10),
  };

  return cachedConfig;
}
