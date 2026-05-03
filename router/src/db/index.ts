import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, "migrations");

const MIGRATION_RENAMES: Record<string, string> = {
  "019_drop_log_redundancy.sql": "020_drop_log_redundancy.sql",
  "020_merge_metrics_columns.sql": "021_merge_metrics_columns.sql",
  // 026 metrics 独立化拆分后重新编号，避免双 026
  "026_metrics_independent.sql": "027_metrics_independent.sql",
  "027_ensure_strategy_column.sql": "028_ensure_strategy_column.sql",
  "028_convert_old_rule_format.sql": "029_convert_old_rule_format.sql",
  "029_add_input_tokens_estimated.sql": "030_add_input_tokens_estimated.sql",
  "030_add_tps_breakdown.sql": "031_add_tps_breakdown.sql",
  // 消除双 033/034，重新编号 035→038
  "033_add_pipeline_snapshot.sql": "033_add_adaptive_concurrency.sql",
  "034_drop_redundant_log_columns.sql": "035_drop_redundant_log_columns.sql",
  "035_add_openai_responses_api_type.sql": "036_add_openai_responses_api_type.sql",
  "036_fix_035_data_corruption.sql": "037_fix_035_data_corruption.sql",
};

export function initDatabase(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (
      db.prepare("SELECT name FROM migrations").all() as { name: string }[]
    ).map((r) => r.name),
  );

  // 将已应用的旧文件名更新为新文件名，避免重命名后重复执行
  for (const [oldName, newName] of Object.entries(MIGRATION_RENAMES)) {
    if (applied.has(oldName) && !applied.has(newName)) {
      db.prepare("UPDATE migrations SET name = ? WHERE name = ?").run(newName, oldName);
      applied.delete(oldName);
      applied.add(newName);
    }
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    try {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      db.transaction(() => {
        // 逐条执行 SQL 语句，对 ALTER TABLE ADD COLUMN 自动跳过已存在的列
        const statements = sql.split(";").map(s => s.trim()).filter(s => s.length > 0);
        for (const stmt of statements) {
          try {
            // 检测 ALTER TABLE ADD COLUMN，若列已存在则跳过
            const alterMatch = /^ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(\S+)/is.exec(stmt);
            if (alterMatch) {
              const tableName = alterMatch[1];
              const columnName = alterMatch[2];
              const cols = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
              if (cols.some(c => c.name === columnName)) {
                continue;
              }
            }
            db.exec(stmt + ";");
          } catch (stmtErr: unknown) {
            // 兼容旧逻辑：仍容忍 "duplicate column name" 错误
            if (stmtErr instanceof Error && stmtErr.message.includes("duplicate column name")) {
              continue;
            }
            throw stmtErr;
          }
        }
        db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(
          file,
          new Date().toISOString(),
        );
      })();
    } catch (err) {
      console.error(`Failed to apply migration ${file}:`, err);
      throw err;
    }
  }

  return db;
}

// --- Re-export from per-table modules ---

export {
  getActiveProviders,
  getAllProviders,
  getProviderById,
  getActiveProviderByName,
  getActiveProvidersWithModels,
  createProvider,
  updateProvider,
  deleteProvider,
  PROVIDER_CONCURRENCY_DEFAULTS,
} from "./providers.js";
export type { Provider } from "./providers.js";

export {
  getMappingGroup,
  getMappingGroupById,
  getAllMappingGroups,
  createMappingGroup,
  updateMappingGroup,
  deleteMappingGroup,
  getActiveProviderModels,
  resolveByProviderModel,
} from "./mappings.js";
export type { MappingGroup, ProviderModelEntry } from "./mappings.js";

export {
  getActiveRetryRules,
  getAllRetryRules,
  getRetryRuleById,
  createRetryRule,
  updateRetryRule,
  deleteRetryRule,
} from "./retry-rules.js";
export type { RetryRule } from "./retry-rules.js";

export {
  insertRequestLog,
  getRequestLogs,
  getRequestLogById,
  deleteLogsBefore,
  getRequestLogChildren,
  getRequestLogsGrouped,
  updateLogStreamContent,
  updateLogClientStatus,
  estimateLogTableSize,
  deleteOldestLogs,
  getLogCount,
  updateLogPipelineSnapshot,
} from "./logs.js";
export type { RequestLog, RequestLogGroupedRow, RequestLogListRow } from "./logs.js";

export {
  getRouterKeyByHash,
  getAllRouterKeys,
  getRouterKeyById,
  createRouterKey,
  updateRouterKey,
  deleteRouterKey,
  getAvailableModels,
} from "./router-keys.js";
export type { RouterKey } from "./router-keys.js";

export { getMetricsSummary, getMetricsTimeseries, insertMetrics } from "./metrics.js";
export type { MetricsSummaryRow, MetricsTimeseriesRow, MetricsPeriod, MetricsMetric, MetricsRow, MetricsInsert } from "./metrics.js";

export { getStats } from "./stats.js";
export type { Stats } from "./stats.js";

export { getSetting, setSetting, isInitialized } from "./settings.js";
export {
  getDbMaxSizeMb, setDbMaxSizeMb,
  getLogTableMaxSizeMb, setLogTableMaxSizeMb,
} from "./settings.js";

export {
  getSessionStates,
  getSessionState,
  getSessionHistory,
  upsertSessionState,
  insertSessionHistory,
  deleteSessionState,
} from "./session-states.js";
export type { SessionModelState, SessionModelHistory, UpsertSessionStateInput, InsertSessionHistoryInput } from "./session-states.js";

export {
  insertWindow,
  getLatestWindow,
  getWindowsInRange,
  getWindowUsage,
} from "./usage-windows.js";
export type { UsageWindow, WindowUsage } from "./usage-windows.js";

export {
  getModelContextWindowOverride,
  getModelInfoForProvider,
  setModelInfoForProvider,
  deleteAllModelInfoForProvider,
  getAllModelInfo,
} from "./model-info.js";
export type { ProviderModelInfo } from "./model-info.js";

export {
  getSchedulesByGroup,
  getActiveSchedulesForGroup,
  getScheduleById,
  getAllSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  deleteSchedulesByGroup,
} from "./schedules.js";
export type { Schedule } from "./schedules.js";

export {
  collectDbSizeInfo,
  runSizeBasedCleanup,
  scheduleDbSizeMonitor,
} from "./db-size-monitor.js";
export type { DbSizeInfo, SizeThresholds, DbSizeMonitorHandle } from "./db-size-monitor.js";
