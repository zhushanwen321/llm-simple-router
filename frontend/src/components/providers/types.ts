import type { ModelInfo } from "@/types/mapping";
import type { ConcurrencyMode } from "@/types/concurrency";
import type { TransformConfig, ProxyConfig } from "@/components/shared/types";

/** ModelCapabilitiesEditor 的聚合 v-model 数据 */
export interface ProviderFormData {
  name: string;
  apiType: string;
  baseUrl: string;
  apiKey: string;
  upstreamPath: string;
  models: ModelInfo[];
  modelInput: string;
  contextWindowSelect: string;
  concurrencyMode: ConcurrencyMode;
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
  transformConfig: TransformConfig;
  proxyConfig: ProxyConfig;
}
