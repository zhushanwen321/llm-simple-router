import Database from "better-sqlite3";
import { getSetting } from "../../db/settings.js";

export interface EnhancementConfig {
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
  tool_round_limit_enabled: boolean;
  tool_error_logging_enabled: boolean;
}

const DEFAULT_CONFIG: EnhancementConfig = {
  tool_call_loop_enabled: false,
  stream_loop_enabled: false,
  tool_round_limit_enabled: true,
  tool_error_logging_enabled: false,
};

// TTL 缓存
let cachedConfig: EnhancementConfig | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000;

/** 集中加载 proxy_enhancement 配置，避免多处重复 getSetting + JSON.parse */
export function loadEnhancementConfig(db: Database.Database): EnhancementConfig {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiry) return cachedConfig;

  const raw = getSetting(db, "proxy_enhancement");
  if (!raw) {
    cachedConfig = { ...DEFAULT_CONFIG };
    cacheExpiry = now + CACHE_TTL_MS;
    return cachedConfig;
  }
  try {
    const parsed = JSON.parse(raw);
    cachedConfig = {
      tool_call_loop_enabled: parsed.tool_call_loop_enabled ?? false,
      stream_loop_enabled: parsed.stream_loop_enabled ?? false,
      tool_round_limit_enabled: parsed.tool_round_limit_enabled ?? true,
      tool_error_logging_enabled: parsed.tool_error_logging_enabled ?? false,
    };
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedConfig;
}

/** 清除 TTL 缓存，供测试和 admin API 更新时调用 */
export function clearEnhancementConfigCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
}
