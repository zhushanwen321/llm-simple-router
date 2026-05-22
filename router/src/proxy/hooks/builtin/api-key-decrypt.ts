/**
 * pre_transport hook: Provider API Key 解密。
 *
 * 在实际发送上游请求前执行（priority 1），解密 provider 的加密 API key，
 * 并通过请求级 Map 缓存避免同一 provider 重复解密。
 *
 * 逻辑：
 * - 从 DB settings 读取 encryption_key
 * - encryption_key 缺失 → PipelineAbort(503)，按 apiType 返回对应格式错误体
 * - 从 decryptedApiKeys Map 查缓存，命中则跳过解密
 * - 未命中则调用 decrypt() 解密并写入缓存
 * - 将解密后的 apiKey 写入 ctx.metadata
 *
 * 依赖：getSetting(db, "encryption_key")、decrypt(ciphertext, key)
 *       ctx.metadata 需预设 "db" 和 "decryptedApiKeys"
 */
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { PipelineAbort } from "../../pipeline/types.js";
import { getSetting } from "../../../db/settings.js";
import { HTTP_SERVICE_UNAVAILABLE } from "../../../core/constants.js";
import { decrypt } from "../../../utils/crypto.js";
import type Database from "better-sqlite3";

export const apiKeyDecryptHook: PipelineHook = {
  name: "builtin:api-key-decrypt",
  phase: "pre_transport",
  priority: 1,
  core: true,
  execute(ctx: PipelineContext): void {
    const db = ctx.deps?.db ?? ctx.metadata.get("db") as Database.Database;
    if (!db) return;
    const provider = ctx.provider!;
    const encryptionKey = getSetting(db, "encryption_key");

    if (!encryptionKey) {
      const errorBody = ctx.apiType === "anthropic"
        ? { type: "error", error: { type: "api_error", message: "Encryption key not configured" } }
        : { error: { message: "Encryption key not configured", type: "server_error", code: "provider_unavailable" } };
      throw new PipelineAbort(HTTP_SERVICE_UNAVAILABLE, errorBody);
    }

    const decryptedApiKeys = ctx.deps?.decryptedApiKeys ?? ctx.metadata.get("decryptedApiKeys") as Map<string, string> ?? new Map<string, string>();
    let apiKey = decryptedApiKeys.get(provider.id);
    if (!apiKey) {
      apiKey = decrypt(provider.api_key, encryptionKey);
      decryptedApiKeys.set(provider.id, apiKey);
    }

    ctx.metadata.set("apiKey", apiKey);
  },
};
