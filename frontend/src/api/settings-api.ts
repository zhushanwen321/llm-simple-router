/**
 * Settings & Admin API — 从 client.ts 拆出以控制行数。
 * 包含：token estimation、client session headers、db size、config sync、upgrade。
 */
import { request } from "./client.js";

export interface ClientSessionHeaderEntry {
  client_type: string;
  session_header_key: string;
}

// --- Token Estimation ---

export function getTokenEstimation() {
  return request<{ enabled: boolean }>("get", "/settings/token-estimation");
}

export function updateTokenEstimation(enabled: boolean) {
  return request<{ success: boolean }>("put", "/settings/token-estimation", { enabled });
}

// --- Client Session Headers ---

export function getClientSessionHeaders() {
  return request<{ entries: ClientSessionHeaderEntry[] }>(
    "get",
    "/settings/client-session-headers",
  );
}

export function updateClientSessionHeaders(entries: ClientSessionHeaderEntry[]) {
  return request<{ success: boolean }>(
    "put",
    "/settings/client-session-headers",
    { entries },
  );
}

// --- DB Size ---

export interface DbSizeInfoResponse {
  totalBytes: number;
  logTableBytes: number;
  logFileBytes: number;
  logCount: number;
  lastChecked: string | null;
  thresholds: {
    dbMaxSizeMb: number;
    logTableMaxSizeMb: number;
  };
}

export function getDbSizeInfo() {
  return request<DbSizeInfoResponse>("get", "/settings/db-size");
}

export function setDbSizeThresholds(data: {
  dbMaxSizeMb?: number;
  logTableMaxSizeMb?: number;
}) {
  return request<{ dbMaxSizeMb: number; logTableMaxSizeMb: number }>(
    "put",
    "/settings/db-size-thresholds",
    data,
  );
}

// --- Config Export/Import ---

export interface ConfigExportResponse {
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export function exportConfig() {
  return request<ConfigExportResponse>("get", "/settings/export");
}

export function importConfig(data: ConfigExportResponse) {
  return request<Record<string, number>>("post", "/settings/import", data);
}

// --- Upgrade ---

export interface UpgradeStatus {
  npm: {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string | null;
  };
  config: {
    hasUpdate: boolean;
    providerChanges: number;
    retryRuleChanges: number;
  };
  deployment: "npm" | "docker" | "unknown";
  syncSource: "github" | "gitee";
  restartMethod: "process_manager" | "self_spawn";
  lastCheckedAt: string | null;
}

export function getUpgradeStatus() {
  return request<UpgradeStatus>("get", "/upgrade/status");
}

export function triggerUpgradeCheck() {
  return request<{ ok: boolean }>("post", "/upgrade/check");
}

export function executeUpgrade(version: string) {
  return request<{ ok: boolean; version: string }>("post", "/upgrade/execute", { version });
}

export function restartServer() {
  return request<{ ok: boolean; method: string }>("post", "/upgrade/restart");
}

export function syncConfig(source: "github" | "gitee") {
  return request<{ ok: boolean }>("post", "/upgrade/sync-config", { source });
}

export function setSyncSource(source: "github" | "gitee") {
  return request<{ ok: boolean }>("put", "/upgrade/sync-source", { source });
}
