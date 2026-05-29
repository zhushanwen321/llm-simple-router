// src/proxy/log-detail-policy.ts
// 已提升到 core/log-detail-policy.ts，此处仅 re-export 保持向后兼容。
// 新代码应直接从 core/log-detail-policy.ts 导入。

export { shouldPreserveDetail, type RetryMatcher } from "../core/log-detail-policy.js";
