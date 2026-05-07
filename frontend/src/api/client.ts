import axios from "axios";
import router from "@/router";
import type { LogEntry } from "@/components/logs/types";
import type { Provider, MappingGroup, ModelMapping, TransformRule } from "@/types/mapping";
import type { Schedule, SchedulePayload } from "@/types/schedule";
import type {
  ActiveRequest,
  StatsSnapshot,
  ProviderConcurrencySnapshot,
  RuntimeMetrics,
} from "@/types/monitor";

// 扩展 AxiosError 类型，附加后端错误信息
declare module "axios" {
  interface AxiosError {
    apiMessage?: string;
    apiCode?: number;
  }
}

const client = axios.create({
  baseURL: "/admin/api",
  withCredentials: true,
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) { // eslint-disable-line no-magic-numbers
      if (error.response.data?.code === 40103) { // eslint-disable-line no-magic-numbers
        router.push("/setup");
      } else {
        router.push("/login");
      }
    }
    // 附加后端错误消息到 error 对象，方便 View 层统一提取
    const body = error.response?.data;
    error.apiMessage = body?.message || "";
    error.apiCode = body?.code || 0;
    return Promise.reject(error);
  },
);

/** 从 AxiosError 提取后端错误消息，无则返回 fallback */
export function getApiMessage(error: unknown, fallback: string): string {
  return (error as { apiMessage?: string }).apiMessage || fallback;
}

// --- API endpoint constants ---

const API = {
  LOGIN: "/login",
  LOGOUT: "/logout",
  PROVIDERS: "/providers",
  MAPPINGS: "/mappings",
  MAPPING_GROUPS: "/mapping-groups",
  RETRY_RULES: "/retry-rules",
  LOGS: "/logs",
  STATS: "/stats",
  METRICS_SUMMARY: "/metrics/summary",
  METRICS_TIMESERIES: "/metrics/timeseries",
  ROUTER_KEYS: "/router-keys",
  MODELS_AVAILABLE: "/models/available",
  PROXY_ENHANCEMENT: "/proxy-enhancement",
  MONITOR_ACTIVE: "/monitor/active",
  MONITOR_RECENT: "/monitor/recent",
  MONITOR_STATS: "/monitor/stats",
  MONITOR_CONCURRENCY: "/monitor/concurrency",
  MONITOR_RUNTIME: "/monitor/runtime",
  MONITOR_STREAM: "/monitor/stream",
  MONITOR_REQUEST: "/monitor/request",
  RECOMMENDED_PROVIDERS: "/recommended/providers",
  RECOMMENDED_RETRY_RULES: "/recommended/retry-rules",
  RECOMMENDED_RELOAD: "/recommended/reload",
  USAGE_WINDOWS: "/usage/windows",
  USAGE_WEEKLY: "/usage/weekly",
  USAGE_MONTHLY: "/usage/monthly",
  SETTINGS_DB_SIZE: "/settings/db-size",
  SETTINGS_DB_SIZE_THRESHOLDS: "/settings/db-size-thresholds",
  SETTINGS_EXPORT: "/settings/export",
  SETTINGS_IMPORT: "/settings/import",
  SETUP_STATUS: "/setup/status",
  SETUP_INITIALIZE: "/setup/initialize",
  SETTINGS_LOG_RETENTION: "/settings/log-retention",
  SCHEDULES: "/schedules",
  SCHEDULES_BY_GROUP: "/schedules/group",
  UPGRADE_STATUS: "/upgrade/status",
  UPGRADE_CHECK: "/upgrade/check",
  UPGRADE_EXECUTE: "/upgrade/execute",
  UPGRADE_RESTART: "/upgrade/restart",
  UPGRADE_SYNC_CONFIG: "/upgrade/sync-config",
  UPGRADE_SYNC_SOURCE: "/upgrade/sync-source",
  TRANSFORM_RULES: "/transform-rules",
  QUICK_SETUP: "/quick-setup",
} as const;

// --- Payload types ---

export interface ProviderPreset {
  plan: string;
  presetName: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  baseUrl: string;
  upstreamPath?: string;
  /** 上游模型列表端点路径，如 /v1/models 或 /models */
  modelsEndpoint?: string;
  models: string[];
}

export interface ProviderGroup {
  group: string;
  presets: ProviderPreset[];
}

export interface RecommendedRetryRule {
  name: string;
  status_code: number;
  body_pattern: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  providers?: string[];
  exists?: boolean;
}

export interface ProviderPayload {
  name: string;
  api_type: string;
  base_url: string;
  upstream_path?: string;
  api_key?: string;
  models?: Array<string | { name: string; context_window?: number; patches?: string[] }>;
  is_active: number;
  max_concurrency?: number;
  queue_timeout_ms?: number;
  max_queue_size?: number;
  adaptive_enabled?: number;
  proxy_type?: string | null;
  proxy_url?: string | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
}

interface MappingPayload {
  client_model: string;
  backend_model: string;
  provider_id: string;
  is_active: number;
}

interface RouterKeyCreatePayload {
  name: string;
  allowed_models?: string[] | null;
}

interface RouterKeyUpdatePayload {
  name?: string;
  allowed_models?: string[] | null;
  is_active?: number;
}

interface MappingGroupPayload {
  client_model: string;
  rule: string; // JSON string: { targets: MappingTarget[] }
}

interface RetryRulePayload {
  name: string;
  status_code: number;
  body_pattern: string;
  is_active?: number;
  retry_strategy?: "fixed" | "exponential";
  retry_delay_ms?: number;
  max_retries?: number;
  max_delay_ms?: number;
}

export interface QuickSetupPayload {
  provider: {
    name: string
    api_type: string
    base_url: string
    upstream_path?: string
    api_key: string
    models: Array<{ name: string; context_window?: number; patches?: string[] }>
    concurrency_mode?: 'auto' | 'manual' | 'none'
    max_concurrency?: number
    queue_timeout_ms?: number
    max_queue_size?: number
  }
  mappings: Array<{ client_model: string; backend_model: string }>
  retry_rules: Array<{
    name: string
    status_code: number
    body_pattern: string
    retry_strategy: string
    retry_delay_ms: number
    max_retries: number
    max_delay_ms: number
  }>
  transform_rules?: {
    inject_headers?: Record<string, string>
    request_defaults?: Record<string, unknown>
    drop_fields?: string[]
  }
}


// --- Response types ---

interface LogsResponse {
  data: LogEntry[];
  total: number;
  page: number;
  limit: number;
}

// 后端直接返回 log 对象，不包装
type LogDetailResponse = LogEntry;

interface DeleteLogsResponse {
  deleted: number;
}

interface RouterKeyPublic {
  id: string;
  name: string;
  key: string | null;
  key_prefix: string;
  allowed_models: string[] | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface RetryRule {
  id: string;
  name: string;
  status_code: number;
  body_pattern: string;
  is_active: number;
  created_at: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
}

interface TimeseriesRawRow {
  time_bucket: string;
  avg_value: number | null;
  count: number;
}

interface MetricsSummaryRow {
  provider_id: string;
  provider_name: string;
  backend_model: string;
  request_count: number;
  avg_ttft_ms: number | null;
  avg_tps: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_hit_tokens: number;
  cache_hit_rate: number | null;
}

interface StatsResponse {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  startTime: string;
  endTime: string;
}

export interface UsageWindowWithUsage {
  window: {
    id: string;
    router_key_id: string | null;
    provider_id: string | null;
    provider_name: string | null;
    start_time: string;
    end_time: string;
    created_at: string;
  };
  usage: {
    request_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
  };
}

export interface DailyUsage {
  date: string;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

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

export interface ConfigExportResponse {
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export interface ProxyEnhancementConfig {
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
  tool_round_limit_enabled: boolean;
  tool_error_logging_enabled: boolean;
}

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

// --- Typed request helper ---
// 解包 AxiosResponse.data，让调用方直接拿到类型化的响应体。

interface RequestOptions {
  params?: Record<string, unknown>;
}

async function request<T>(
  method: "get" | "post" | "put" | "delete",
  url: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<T> {
  let res;
  if (method === "get") {
    res = await client.get(url, { params: options?.params });
  } else if (method === "delete" && data) {
    res = await client.delete(url, { data });
  } else {
    res = await client.request({ method, url, data, params: options?.params });
  }
  // 解包信封：后端返回 {code:0, message:"ok", data:T}
  const body = res.data as { code: number; message: string; data: T };
  return body.data;
}

// --- API ---

export const api = {
  login: (password: string) =>
    request<{ success: boolean }>("post", API.LOGIN, { password }),
  logout: () => request<{ success: boolean }>("post", API.LOGOUT),

  getSetupStatus: () =>
    request<{ initialized: boolean }>("get", API.SETUP_STATUS),
  initializeSetup: (password: string) =>
    request<{ success: boolean }>("post", API.SETUP_INITIALIZE, { password }),

  getProviders: () => request<Provider[]>("get", API.PROVIDERS),
  createProvider: (data: ProviderPayload) =>
    request<{ id: string }>("post", API.PROVIDERS, data),
  updateProvider: (id: string, data: Partial<ProviderPayload>) =>
    request<{
      success: boolean;
      cascadedGroups: Array<{
        id: string;
        client_model: string;
        disabled: boolean;
      }>;
    }>("put", `${API.PROVIDERS}/${id}`, data),
  deleteProvider: (id: string) =>
    request<{ success: boolean }>("delete", `${API.PROVIDERS}/${id}`),
  getProviderDependencies: (id: string) =>
    request<{ references: string[] }>(
      "get",
      `${API.PROVIDERS}/${id}/dependencies`,
    ),
  fetchUpstreamModels: (data: {
    base_url: string;
    models_endpoint: string;
    api_key: string;
    api_type: string;
  }) => request<string[]>("post", `${API.PROVIDERS}/fetch-models`, data),

  getMappings: () => request<ModelMapping[]>("get", API.MAPPINGS),
  createMapping: (data: MappingPayload) =>
    request<{ id: string }>("post", API.MAPPINGS, data),
  updateMapping: (id: string, data: MappingPayload) =>
    request<{ success: boolean }>("put", `${API.MAPPINGS}/${id}`, data),
  deleteMapping: (id: string) =>
    request<{ success: boolean }>("delete", `${API.MAPPINGS}/${id}`),

  getLogs: (params: {
    page: number;
    limit: number;
    api_type?: string;
    router_key_id?: string;
    provider_id?: string;
    model?: string;
    start_time?: string;
    end_time?: string;
    status_code?: string;
    view?: string;
  }) => request<LogsResponse>("get", API.LOGS, undefined, { params }),
  getLogDetail: (id: string) =>
    request<LogDetailResponse>("get", `${API.LOGS}/${id}`),
  getLogChildren: (id: string) =>
    request<LogEntry[]>("get", `${API.LOGS}/${id}/children`),
  deleteLogsBefore: (before: string) =>
    request<DeleteLogsResponse>("delete", `${API.LOGS}/before`, { before }),
  getLogRetention: () =>
    request<{ days: number }>("get", API.SETTINGS_LOG_RETENTION),
  setLogRetention: (days: number) =>
    request<{ days: number }>("put", API.SETTINGS_LOG_RETENTION, { days }),

  getStats: (params?: {
    period?: string;
    start_time?: string;
    end_time?: string;
    router_key_id?: string;
    provider_id?: string;
    backend_model?: string;
  }) => request<StatsResponse>("get", API.STATS, undefined, { params }),

  getMetricsSummary: (params: {
    period?: string;
    provider_id?: string;
    backend_model?: string;
    router_key_id?: string;
    start_time?: string;
    end_time?: string;
  }) =>
    request<MetricsSummaryRow[]>("get", API.METRICS_SUMMARY, undefined, {
      params,
    }),
  getMetricsTimeseries: (params: {
    period?: string;
    metric: string;
    provider_id?: string;
    backend_model?: string;
    router_key_id?: string;
    start_time?: string;
    end_time?: string;
  }) =>
    request<TimeseriesRawRow[]>("get", API.METRICS_TIMESERIES, undefined, {
      params,
    }),

  getRouterKeys: () => request<RouterKeyPublic[]>("get", API.ROUTER_KEYS),
  createRouterKey: (data: RouterKeyCreatePayload) =>
    request<{ id: string; name: string; key: string }>(
      "post",
      API.ROUTER_KEYS,
      data,
    ),
  updateRouterKey: (id: string, data: RouterKeyUpdatePayload) =>
    request<{ success: boolean }>("put", `${API.ROUTER_KEYS}/${id}`, data),
  deleteRouterKey: (id: string) =>
    request<{ success: boolean }>("delete", `${API.ROUTER_KEYS}/${id}`),
  getAvailableModels: () => request<string[]>("get", API.MODELS_AVAILABLE),

  getMappingGroups: () => request<MappingGroup[]>("get", API.MAPPING_GROUPS),
  createMappingGroup: (data: MappingGroupPayload) =>
    request<{ id: string }>("post", API.MAPPING_GROUPS, data),
  updateMappingGroup: (id: string, data: MappingGroupPayload) =>
    request<{ success: boolean }>("put", `${API.MAPPING_GROUPS}/${id}`, data),
  deleteMappingGroup: (id: string) =>
    request<{ success: boolean }>("delete", `${API.MAPPING_GROUPS}/${id}`),
  toggleMappingGroup: (id: string) =>
    request<{ success: boolean; is_active: number }>(
      "post",
      `${API.MAPPING_GROUPS}/${id}/toggle`,
    ),

  getRetryRules: () => request<RetryRule[]>("get", API.RETRY_RULES),
  createRetryRule: (data: RetryRulePayload) =>
    request<{ id: string }>("post", API.RETRY_RULES, data),
  updateRetryRule: (id: string, data: RetryRulePayload) =>
    request<{ success: boolean }>("put", `${API.RETRY_RULES}/${id}`, data),
  deleteRetryRule: (id: string) =>
    request<{ success: boolean }>("delete", `${API.RETRY_RULES}/${id}`),

  getSchedules: () => request<Schedule[]>("get", API.SCHEDULES),
  getSchedulesByGroup: (groupId: string) =>
    request<Schedule[]>("get", `${API.SCHEDULES_BY_GROUP}/${groupId}`),
  createSchedule: (data: SchedulePayload) =>
    request<{ id: string }>("post", API.SCHEDULES, data),
  updateSchedule: (id: string, data: Partial<SchedulePayload>) =>
    request<{ success: boolean }>("put", `${API.SCHEDULES}/${id}`, data),
  deleteSchedule: (id: string) =>
    request<{ success: boolean }>("delete", `${API.SCHEDULES}/${id}`),
  toggleSchedule: (id: string) =>
    request<{ success: boolean; enabled: number }>(
      "post",
      `${API.SCHEDULES}/${id}/toggle`,
    ),

  getProxyEnhancement: () =>
    request<ProxyEnhancementConfig>("get", API.PROXY_ENHANCEMENT),
  updateProxyEnhancement: (data: ProxyEnhancementConfig) =>
    request<{ success: boolean }>("put", API.PROXY_ENHANCEMENT, data),

  getMonitorActive: () => request<ActiveRequest[]>("get", API.MONITOR_ACTIVE),
  getMonitorRecent: () => request<ActiveRequest[]>("get", API.MONITOR_RECENT),
  getMonitorStats: () => request<StatsSnapshot>("get", API.MONITOR_STATS),
  getMonitorRequest: (id: string) =>
    request<ActiveRequest>("get", `${API.MONITOR_REQUEST}/${id}`),
  getMonitorConcurrency: () =>
    request<ProviderConcurrencySnapshot[]>("get", API.MONITOR_CONCURRENCY),
  getMonitorRuntime: () => request<RuntimeMetrics>("get", API.MONITOR_RUNTIME),

  recommended: {
    getProviders: () =>
      request<ProviderGroup[]>("get", API.RECOMMENDED_PROVIDERS),
    getRetryRules: () =>
      request<RecommendedRetryRule[]>("get", API.RECOMMENDED_RETRY_RULES),
    reload: () => request<{ ok: boolean }>("post", API.RECOMMENDED_RELOAD),
  },

  getUsageWindows: (params?: {
    router_key_id?: string;
    provider_id?: string;
  }) =>
    request<UsageWindowWithUsage[]>("get", API.USAGE_WINDOWS, undefined, {
      params,
    }),
  getUsageWeekly: (params?: { router_key_id?: string }) =>
    request<DailyUsage[]>("get", API.USAGE_WEEKLY, undefined, { params }),
  getUsageMonthly: (params?: { router_key_id?: string }) =>
    request<DailyUsage[]>("get", API.USAGE_MONTHLY, undefined, { params }),

  getDbSizeInfo: () => request<DbSizeInfoResponse>("get", API.SETTINGS_DB_SIZE),
  setDbSizeThresholds: (data: {
    dbMaxSizeMb?: number;
    logTableMaxSizeMb?: number;
  }) =>
    request<{ dbMaxSizeMb: number; logTableMaxSizeMb: number }>(
      "put",
      API.SETTINGS_DB_SIZE_THRESHOLDS,
      data,
    ),
  exportConfig: () => request<ConfigExportResponse>("get", API.SETTINGS_EXPORT),
  importConfig: (data: ConfigExportResponse) =>
    request<Record<string, number>>("post", API.SETTINGS_IMPORT, data),

  getUpgradeStatus: () => request<UpgradeStatus>("get", API.UPGRADE_STATUS),
  triggerUpgradeCheck: () =>
    request<{ ok: boolean }>("post", API.UPGRADE_CHECK),
  executeUpgrade: (version: string) =>
    request<{ ok: boolean; version: string }>("post", API.UPGRADE_EXECUTE, {
      version,
    }),
  restartServer: () =>
    request<{ ok: boolean; method: string }>("post", API.UPGRADE_RESTART),
  syncConfig: (source: "github" | "gitee") =>
    request<{ ok: boolean }>("post", API.UPGRADE_SYNC_CONFIG, { source }),
  setSyncSource: (source: "github" | "gitee") =>
    request<{ ok: boolean }>("put", API.UPGRADE_SYNC_SOURCE, { source }),

  // Transform Rules
  getTransformRules: (providerId: string) =>
    request<TransformRule | null>("get", `${API.TRANSFORM_RULES}/${providerId}`),
  upsertTransformRules: (providerId: string, data: Partial<TransformRule>) =>
    request<{ success: boolean }>("put", `${API.TRANSFORM_RULES}/${providerId}`, data),
  deleteTransformRules: (providerId: string) =>
    request<{ success: boolean }>("delete", `${API.TRANSFORM_RULES}/${providerId}`),
  reloadTransformRules: () =>
    request<{ loadedPlugins: string[]; rulesCount: number }>("post", `${API.TRANSFORM_RULES}/reload`),

  quickSetup: (data: QuickSetupPayload) =>
    request<{ success: boolean; provider_id: string }>("post", API.QUICK_SETUP, data),
};
