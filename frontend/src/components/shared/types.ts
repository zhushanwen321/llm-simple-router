import type { ConcurrencyMode } from "@/types/concurrency";

export interface ConcurrencyConfig {
  mode: ConcurrencyMode;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}

export interface TransformConfig {
  injectHeaders: string;
  dropFields: string;
  requestDefaults: string;
}

export interface ProxyConfig {
  proxyType: string;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  mode: "auto",
  max_concurrency: 10,
  queue_timeout_ms: 120000,
  max_queue_size: 100,
};

export const DEFAULT_CONCURRENCY_MANUAL_CONFIG: ConcurrencyConfig = {
  mode: "manual",
  max_concurrency: 3,
  queue_timeout_ms: 120000,
  max_queue_size: 10,
};

export const DEFAULT_TRANSFORM_CONFIG: TransformConfig = {
  injectHeaders: "",
  dropFields: "",
  requestDefaults: "",
};

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  proxyType: "",
  proxyUrl: "",
  proxyUsername: "",
  proxyPassword: "",
};
