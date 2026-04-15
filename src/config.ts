import "dotenv/config";

export interface Config {
  ROUTER_API_KEY: string;
  ADMIN_PASSWORD: string;
  ENCRYPTION_KEY: string;
  PORT: number;
  DB_PATH: string;
  LOG_LEVEL: string;
  TZ: string;
  STREAM_TIMEOUT_MS: number;
}

let cachedConfig: Config | null = null;

export function resetConfig(): void {
  cachedConfig = null;
}

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const requiredVars = ["ROUTER_API_KEY", "ADMIN_PASSWORD", "ENCRYPTION_KEY"];
  for (const name of requiredVars) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  cachedConfig = {
    ROUTER_API_KEY: process.env.ROUTER_API_KEY!,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
    PORT: parseInt(process.env.PORT || "3000", 10),
    DB_PATH: process.env.DB_PATH || "./data/router.db",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    TZ: process.env.TZ || "Asia/Shanghai",
    STREAM_TIMEOUT_MS: parseInt(process.env.STREAM_TIMEOUT_MS || "30000", 10),
  };

  return cachedConfig;
}
