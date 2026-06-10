// src/proxy/log-detail-policy.ts
// 策略逻辑已提升到 core 层，此文件保留 re-export 兼容
export { shouldPreserveDetail, type RetryMatcher } from "../core/log-detail-policy.js";
