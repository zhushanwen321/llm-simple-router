import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, "migrations");

export function initDatabase(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);

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

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    try {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      db.exec(sql);
    } catch (err) {
      console.error(`Failed to apply migration ${file}:`, err);
      throw err;
    }
    db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString(),
    );
  }

  return db;
}

// --- Re-export from per-table modules ---

export {
  getActiveProviders,
  getAllProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
} from "./providers.js";
export type { Provider } from "./providers.js";

export {
  getModelMapping,
  getAllModelMappings,
  createModelMapping,
  updateModelMapping,
  deleteModelMapping,
  getMappingGroup,
  getMappingGroupById,
  getAllMappingGroups,
  createMappingGroup,
  updateMappingGroup,
  deleteMappingGroup,
  getActiveProviderModels,
  resolveByProviderModel,
} from "./mappings.js";
export type { ModelMapping, MappingGroup, ProviderModelEntry } from "./mappings.js";

export {
  getActiveRetryRules,
  getAllRetryRules,
  createRetryRule,
  updateRetryRule,
  deleteRetryRule,
  seedDefaultRules,
} from "./retry-rules.js";
export type { RetryRule } from "./retry-rules.js";

export {
  insertRequestLog,
  getRequestLogs,
  getRequestLogById,
  deleteLogsBefore,
  insertMetrics,
} from "./logs.js";
export type { RequestLog, MetricsRow, MetricsInsert } from "./logs.js";

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

export { getMetricsSummary, getMetricsTimeseries } from "./metrics.js";
export type { MetricsSummaryRow, MetricsTimeseriesRow, MetricsPeriod, MetricsMetric } from "./metrics.js";

export { getStats } from "./stats.js";
export type { Stats, StatsPeriod } from "./stats.js";

export { getSetting, setSetting, isInitialized } from "./settings.js";

export {
  getSessionStates,
  getSessionState,
  getSessionHistory,
  upsertSessionState,
  insertSessionHistory,
  deleteSessionState,
} from "./session-states.js";
export type { SessionModelState, SessionModelHistory, UpsertSessionStateInput, InsertSessionHistoryInput } from "./session-states.js";
