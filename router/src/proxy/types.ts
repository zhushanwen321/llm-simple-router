// src/proxy/types.ts — proxy 内部类型 + core 公共类型 re-export

// Re-export 公共类型（已被 core 取代）
export { UPSTREAM_SUCCESS, filterHeaders } from "../core/constants.js";
export type { RawHeaders, TransportResult, StreamState, MetricsResult } from "../core/types.js";
// ProviderSwitchNeeded 已移至 core/errors.ts
export { ProviderSwitchNeeded } from "../core/errors.js";
