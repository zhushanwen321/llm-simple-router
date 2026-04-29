// src/proxy/types.ts — proxy 内部类型 + core 公共类型 re-export

// Re-export 公共类型（已被 core/types.ts 和 core/errors.ts 取代）
export { UPSTREAM_SUCCESS, filterHeaders } from "../core/types.js";
export type { RawHeaders, TransportResult, StreamState } from "../core/types.js";
export { ProviderSwitchNeeded } from "../core/errors.js";
