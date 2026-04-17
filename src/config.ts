import "dotenv/config";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getSetting, isInitialized } from "./db/settings.js";

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
  needsSetup: boolean;
}

let cachedConfig: Config | null = null;

// DB_PATH 迁移策略：环境变量 > ./data/router.db 已存在 > ~/.llm-simple-router/router.db
function getDefaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const localPath = "./data/router.db";
  if (existsSync(localPath)) return localPath;
  return join(homedir(), ".llm-simple-router", "router.db");
}

export function resetConfig(): void {
  cachedConfig = null;
}

// 阶段 1：基础配置，不校验 secrets
export function getBaseConfig(): Config {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
    JWT_SECRET: process.env.JWT_SECRET ?? "",
    PORT: parseInt(process.env.PORT || "9981", 10),
    DB_PATH: getDefaultDbPath(),
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    TZ: process.env.TZ || "Asia/Shanghai",
    STREAM_TIMEOUT_MS: parseInt(process.env.STREAM_TIMEOUT_MS || "3000000", 10),
    RETRY_MAX_ATTEMPTS: parseInt(process.env.RETRY_MAX_ATTEMPTS || "3", 10),
    RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || "1000", 10),
    needsSetup: false,
  };
  return cachedConfig;
}

// 阶段 2：DB 就绪后从 settings 表加载 secrets
export function loadSettingsToConfig(db: Database.Database): void {
  const config = getBaseConfig();
  // 环境变量已满足则跳过
  if (config.ADMIN_PASSWORD && config.ENCRYPTION_KEY && config.JWT_SECRET) return;

  // 延迟导入避免循环依赖
  if (!isInitialized(db)) {
    config.needsSetup = true;
    return;
  }
  if (!config.ADMIN_PASSWORD) {
    // DB 模式下密码以 hash 形式存储，标记为占位值表示"使用 DB 验证"
    const hash = getSetting(db, "admin_password_hash");
    if (hash) config.ADMIN_PASSWORD = "__DB_AUTH__";
  }
  if (!config.ENCRYPTION_KEY) config.ENCRYPTION_KEY = getSetting(db, "encryption_key") ?? "";
  if (!config.JWT_SECRET) config.JWT_SECRET = getSetting(db, "jwt_secret") ?? "";
}

export function getConfig(): Config {
  return getBaseConfig();
}
