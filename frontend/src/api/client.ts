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

interface MetricsSummaryResponse {
  rows: MetricsSummaryRow[];
  client_type_breakdown: Record<string, number>;
  cache_hit_rate: number;
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

export interface ProxyEnhancementConfig {
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
  tool_round_limit_enabled: boolean;
  tool_error_logging_enabled: boolean;
}

// --- Typed request helper ---
// 解包 AxiosResponse.data，让调用方直接拿到类型化的响应体。

interface RequestOptions {
  params?: Record<string, unknown>;
}

export async function request<T>(
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
    request<{ success: boolean }>("post", "/login", { password }),
  logout: () => request<{ success: boolean }>("post", "/logout"),

  getSetupStatus: () =>
    request<{ initialized: boolean }>("get", "/setup/status"),
  initializeSetup: (password: string) =>
    request<{ success: boolean }>("post", "/setup/initialize", { password }),

  getProviders: () => request<Provider[]>("get", "/providers"),
  createProvider: (data: ProviderPayload) =>
    request<{ id: string }>("post", "/providers", data),
  updateProvider: (id: string, data: Partial<ProviderPayload>) =>
    request<{
      success: boolean;
      cascadedGroups: Array<{
        id: string;
        client_model: string;
        disabled: boolean;
      }>;
    }>("put", `/providers/${id}`, data),
  deleteProvider: (id: string) =>
    request<{ success: boolean }>("delete", `/providers/${id}`),
  getProviderDependencies: (id: string) =>
    request<{ references: string[] }>("get", `/providers/${id}/dependencies`),
  fetchUpstreamModels: (data: {
    base_url: string;
    models_endpoint: string;
    api_key: string;
    api_type: string;
  }) => request<string[]>("post", "/providers/fetch-models", data),

  getMappings: () => request<ModelMapping[]>("get", "/mappings"),
  createMapping: (data: MappingPayload) =>
    request<{ id: string }>("post", "/mappings", data),
  updateMapping: (id: string, data: MappingPayload) =>
    request<{ success: boolean }>("put", `/mappings/${id}`, data),
  deleteMapping: (id: string) =>
    request<{ success: boolean }>("delete", `/mappings/${id}`),

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
  }) => request<LogsResponse>("get", "/logs", undefined, { params }),
  getLogDetail: (id: string) =>
    request<LogDetailResponse>("get", `/logs/${id}`),
  getLogChildren: (id: string) =>
    request<LogEntry[]>("get", `/logs/${id}/children`),
  deleteLogsBefore: (before: string) =>
    request<DeleteLogsResponse>("delete", "/logs/before", { before }),
  getLogRetention: () =>
    request<{ days: number }>("get", "/settings/log-retention"),
  setLogRetention: (days: number) =>
    request<{ days: number }>("put", "/settings/log-retention", { days }),

  getStats: (params?: {
    period?: string;
    start_time?: string;
    end_time?: string;
    router_key_id?: string;
    provider_id?: string;
    backend_model?: string;
  }) => request<StatsResponse>("get", "/stats", undefined, { params }),

  getMetricsSummary: (params: {
    period?: string;
    provider_id?: string;
    backend_model?: string;
    router_key_id?: string;
    client_type?: string;
    start_time?: string;
    end_time?: string;
  }) =>
    request<MetricsSummaryResponse>("get", "/metrics/summary", undefined, { params }),
  getMetricsTimeseries: (params: {
    period?: string;
    metric: string;
    provider_id?: string;
    backend_model?: string;
    router_key_id?: string;
    start_time?: string;
    end_time?: string;
  }) =>
    request<TimeseriesRawRow[]>("get", "/metrics/timeseries", undefined, { params }),

  getRouterKeys: () => request<RouterKeyPublic[]>("get", "/router-keys"),
  createRouterKey: (data: RouterKeyCreatePayload) =>
    request<{ id: string; name: string; key: string }>("post", "/router-keys", data),
  updateRouterKey: (id: string, data: RouterKeyUpdatePayload) =>
    request<{ success: boolean }>("put", `/router-keys/${id}`, data),
  deleteRouterKey: (id: string) =>
    request<{ success: boolean }>("delete", `/router-keys/${id}`),
  getAvailableModels: () => request<string[]>("get", "/models/available"),

  getMappingGroups: () => request<MappingGroup[]>("get", "/mapping-groups"),
  createMappingGroup: (data: MappingGroupPayload) =>
    request<{ id: string }>("post", "/mapping-groups", data),
  updateMappingGroup: (id: string, data: MappingGroupPayload) =>
    request<{ success: boolean }>("put", `/mapping-groups/${id}`, data),
  deleteMappingGroup: (id: string) =>
    request<{ success: boolean }>("delete", `/mapping-groups/${id}`),
  toggleMappingGroup: (id: string) =>
    request<{ success: boolean; is_active: number }>("post", `/mapping-groups/${id}/toggle`),

  getRetryRules: () => request<RetryRule[]>("get", "/retry-rules"),
  createRetryRule: (data: RetryRulePayload) =>
    request<{ id: string }>("post", "/retry-rules", data),
  updateRetryRule: (id: string, data: RetryRulePayload) =>
    request<{ success: boolean }>("put", `/retry-rules/${id}`, data),
  deleteRetryRule: (id: string) =>
    request<{ success: boolean }>("delete", `/retry-rules/${id}`),

  getSchedules: () => request<Schedule[]>("get", "/schedules"),
  getSchedulesByGroup: (groupId: string) =>
    request<Schedule[]>("get", `/schedules/group/${groupId}`),
  createSchedule: (data: SchedulePayload) =>
    request<{ id: string }>("post", "/schedules", data),
  updateSchedule: (id: string, data: Partial<SchedulePayload>) =>
    request<{ success: boolean }>("put", `/schedules/${id}`, data),
  deleteSchedule: (id: string) =>
    request<{ success: boolean }>("delete", `/schedules/${id}`),
  toggleSchedule: (id: string) =>
    request<{ success: boolean; enabled: number }>("post", `/schedules/${id}/toggle`),

  getProxyEnhancement: () =>
    request<ProxyEnhancementConfig>("get", "/proxy-enhancement"),
  updateProxyEnhancement: (data: ProxyEnhancementConfig) =>
    request<{ success: boolean }>("put", "/proxy-enhancement", data),

  getMonitorActive: () => request<ActiveRequest[]>("get", "/monitor/active"),
  getMonitorRecent: () => request<ActiveRequest[]>("get", "/monitor/recent"),
  getMonitorStats: () => request<StatsSnapshot>("get", "/monitor/stats"),
  getMonitorRequest: (id: string) =>
    request<ActiveRequest>("get", `/monitor/request/${id}`),
  getMonitorConcurrency: () =>
    request<ProviderConcurrencySnapshot[]>("get", "/monitor/concurrency"),
  getMonitorRuntime: () => request<RuntimeMetrics>("get", "/monitor/runtime"),
  killMonitorRequest: (id: string) =>
    request<{ killed: boolean }>("delete", `/monitor/request/${id}`),

  recommended: {
    getProviders: () =>
      request<ProviderGroup[]>("get", "/recommended/providers"),
    getRetryRules: () =>
      request<RecommendedRetryRule[]>("get", "/recommended/retry-rules"),
    reload: () => request<{ ok: boolean }>("post", "/recommended/reload"),
  },

  getUsageWindows: (params?: {
    router_key_id?: string;
    provider_id?: string;
  }) =>
    request<UsageWindowWithUsage[]>("get", "/usage/windows", undefined, { params }),
  getUsageWeekly: (params?: { router_key_id?: string }) =>
    request<DailyUsage[]>("get", "/usage/weekly", undefined, { params }),
  getUsageMonthly: (params?: { router_key_id?: string }) =>
    request<DailyUsage[]>("get", "/usage/monthly", undefined, { params }),

  // Transform Rules
  getTransformRules: (providerId: string) =>
    request<TransformRule | null>("get", `/transform-rules/${providerId}`),
  upsertTransformRules: (providerId: string, data: Partial<TransformRule>) =>
    request<{ success: boolean }>("put", `/transform-rules/${providerId}`, data),
  deleteTransformRules: (providerId: string) =>
    request<{ success: boolean }>("delete", `/transform-rules/${providerId}`),
  reloadTransformRules: () =>
    request<{ loadedPlugins: string[]; rulesCount: number }>("post", "/transform-rules/reload"),

  quickSetup: (data: QuickSetupPayload) =>
    request<{ success: boolean; provider_id: string }>("post", "/quick-setup", data),
};
