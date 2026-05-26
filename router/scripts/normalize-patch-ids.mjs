#!/usr/bin/env node
/**
 * 清洗 providers.models 中的 patches：
 * 1. 将连字符格式的 patch ID 转为下划线格式
 * 2. 迁移旧 patch ID 到当前标准名
 * 3. 去重同一 model entry 中的重复 patches
 *
 * 用法: node scripts/normalize-patch-ids.mjs [db-path]
 * 默认 db-path: ~/.llm-simple-router/router.db
 */

import Database from "better-sqlite3";
import { homedir } from "os";
import { resolve } from "path";

const dbPath = process.argv[2] || resolve(homedir(), ".llm-simple-router/router.db");

// Patch ID 归一化映射：连字符 → 下划线
const HYPHEN_PATCH_MAP = {
  "thinking-consistency": "thinking_consistency",
  "orphan-tool-results-oa": "orphan_tool_results_oa",
  "orphan-tool-results": "orphan_tool_results",
  "developer-role": "developer_role",
};

// 旧 patch ID 迁移到当前标准名
const LEGACY_PATCH_MAP = {
  thinking_param: "thinking_consistency",
  thinking_blocks: "thinking_consistency",
  non_ds_tools: "thinking_consistency",
  cache_control: "thinking_consistency",
};

// 合并所有映射（legacy 优先，因为它们已经是下划线格式）
const ALL_PATCH_MAP = { ...LEGACY_PATCH_MAP, ...HYPHEN_PATCH_MAP };

function normalizePatches(patches) {
  const normalized = patches.map((p) => ALL_PATCH_MAP[p] ?? p);
  return [...new Set(normalized)];
}

function processProvider(db, provider) {
  let models;
  try {
    models = JSON.parse(provider.models);
  } catch {
    return { id: provider.id, status: "skip", reason: "invalid JSON" };
  }

  if (!Array.isArray(models)) return { id: provider.id, status: "skip", reason: "not array" };

  let changed = false;
  const updated = models.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry.patches || !Array.isArray(entry.patches) || entry.patches.length === 0) return entry;

    const before = JSON.stringify(entry.patches);
    const normalized = normalizePatches(entry.patches);
    const after = JSON.stringify(normalized);

    if (before !== after) {
      changed = true;
      return { ...entry, patches: normalized };
    }
    return entry;
  });

  if (!changed) return { id: provider.id, status: "unchanged" };

  const newModels = JSON.stringify(updated);
  const stmt = db.prepare("UPDATE providers SET models = ? WHERE id = ?");
  stmt.run(newModels, provider.id);
  return { id: provider.id, status: "updated" };
}

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);

const providers = db.prepare("SELECT id, models FROM providers WHERE models IS NOT NULL AND models != '[]'").all();
console.log(`Found ${providers.length} providers with models`);

let updated = 0;
let unchanged = 0;
let skipped = 0;

const tx = db.transaction(() => {
  for (const provider of providers) {
    const result = processProvider(db, provider);
    if (result.status === "updated") {
      updated++;
      console.log(`  [UPDATED] ${provider.id}`);
    } else if (result.status === "unchanged") {
      unchanged++;
    } else {
      skipped++;
      console.log(`  [SKIP] ${provider.id}: ${result.reason}`);
    }
  }
});

tx();
db.close();

console.log(`\nDone: ${updated} updated, ${unchanged} unchanged, ${skipped} skipped`);
