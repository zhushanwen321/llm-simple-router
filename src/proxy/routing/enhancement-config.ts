import Database from "better-sqlite3";
import { getSetting } from "../../db/settings.js";

export interface EnhancementConfig {
  claude_code_enabled: boolean;
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
}

const DEFAULT_CONFIG: EnhancementConfig = {
  claude_code_enabled: false,
  tool_call_loop_enabled: false,
  stream_loop_enabled: false,
};

/** 集中加载 proxy_enhancement 配置，避免多处重复 getSetting + JSON.parse */
export function loadEnhancementConfig(db: Database.Database): EnhancementConfig {
  const raw = getSetting(db, "proxy_enhancement");
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return {
      claude_code_enabled: parsed.claude_code_enabled ?? false,
      tool_call_loop_enabled: parsed.tool_call_loop_enabled ?? false,
      stream_loop_enabled: parsed.stream_loop_enabled ?? false,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
