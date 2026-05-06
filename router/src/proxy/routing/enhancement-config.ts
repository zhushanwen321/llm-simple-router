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

/** 集中加载 proxy_enhancement 配置，避免多处重复 getSetting + JSON.parse */
export function loadEnhancementConfig(db: Database.Database): EnhancementConfig {
  const raw = getSetting(db, "proxy_enhancement");
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return {
      tool_call_loop_enabled: parsed.tool_call_loop_enabled ?? false,
      stream_loop_enabled: parsed.stream_loop_enabled ?? false,
      tool_round_limit_enabled: parsed.tool_round_limit_enabled ?? true,
      tool_error_logging_enabled: parsed.tool_error_logging_enabled ?? false,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
