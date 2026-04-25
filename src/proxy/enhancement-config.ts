import Database from "better-sqlite3";
import { getSetting } from "../db/settings.js";

export interface EnhancementConfig {
  claude_code_enabled: boolean;
  context_compact_enabled: boolean;
  compact_provider_id: string | null;
  compact_model: string | null;
  custom_prompt_enabled: boolean;
  custom_prompt: string | null;
}

const DEFAULT_CONFIG: EnhancementConfig = {
  claude_code_enabled: false,
  context_compact_enabled: false,
  compact_provider_id: null,
  compact_model: null,
  custom_prompt_enabled: false,
  custom_prompt: null,
};

/** 集中加载 proxy_enhancement 配置，避免多处重复 getSetting + JSON.parse */
export function loadEnhancementConfig(db: Database.Database): EnhancementConfig {
  const raw = getSetting(db, "proxy_enhancement");
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}
