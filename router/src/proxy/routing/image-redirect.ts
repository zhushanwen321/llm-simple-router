/**
 * IR（Image Redirect）预计算层
 *
 * 纯函数：检测请求体是否包含图片，若首 target 不支持图片且配置了 image_fallback，
 * 则将 fallback target prepend 到列表头部。
 */
import type Database from "better-sqlite3";
import type { Target } from "../../core/types.js";
import { PipelineSnapshot, type StageRecord } from "../pipeline-snapshot.js";
import { getProviderById } from "../../db/providers.js";
import { getMappingGroup } from "../../db/mappings.js";
import { parseModels } from "../../config/model-context.js";

// ---------- hasImage ----------

/**
 * 检测请求体是否包含图片，支持三种 API 格式：
 * 1. OpenAI: messages[].content 为数组且含 type="image_url"
 * 2. Anthropic: messages[].content[] 含 type="image"
 * 3. Responses API: input[] 含 type="input_image"（顶层或嵌套在 message content 中）
 */
export function hasImage(body: Record<string, unknown>): boolean {
  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg == null || typeof msg !== "object") continue;
      const content = (msg as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block == null || typeof block !== "object") continue;
        const t = (block as Record<string, unknown>).type;
        if (t === "image_url" || t === "image") return true;
      }
    }
  }

  // Responses API: input[]
  const input = body.input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item == null || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      // 顶层 input_image
      if (rec.type === "input_image") return true;
      // 嵌套在 message 的 content 中
      const content = rec.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block == null || typeof block !== "object") continue;
          if ((block as Record<string, unknown>).type === "input_image") return true;
        }
      }
    }
  }

  return false;
}

// ---------- computeImageRedirectTargets ----------

/** 判断模型 capabilities 是否包含 image */
function supportsImage(capabilities: string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes("image");
}

/**
 * IR 层主函数。异常安全：任何内部错误均 catch 并返回原始 targets。
 */
export function computeImageRedirectTargets(
  db: Database.Database,
  targets: Target[],
  clientModel: string,
  body: Record<string, unknown>,
  snapshot: PipelineSnapshot,
): Target[] {
  try {
  // 空列表直接返回
    if (targets.length === 0) return targets;

    // 无图片 → no-op，记录 triggered:false
    if (!hasImage(body)) {
      snapshot.add({
        stage: "image-redirect",
        triggered: false,
        original_model: targets[0].backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "no-image-detected",
      } satisfies StageRecord);
      return targets;
    }

    // 检查首 target 的 provider 是否已支持图片
    const firstTarget = targets[0];
    const provider = getProviderById(db, firstTarget.provider_id);
    if (provider) {
      const entries = parseModels(provider.models);
      const entry = entries.find(e => e.name === firstTarget.backend_model);
      if (entry && supportsImage(entry.capabilities)) {
        // 首 target 已支持图片，无需 redirect
        snapshot.add({
          stage: "image-redirect",
          triggered: false,
          original_model: firstTarget.backend_model,
          redirect_to: "",
          redirect_provider: "",
          reason: "first-target-already-supports-image",
        } satisfies StageRecord);
        return targets;
      }
    }

    // 查找 image_fallback 配置
    const group = getMappingGroup(db, clientModel);
    if (!group) {
      snapshot.add({
        stage: "image-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "no-mapping-group",
      } satisfies StageRecord);
      return targets;
    }

    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(group.rule) as Record<string, unknown>;
    } catch {
      snapshot.add({
        stage: "image-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "rule-parse-error",
      } satisfies StageRecord);
      return targets;
    }

    const fallback = rule.image_fallback;
    if (fallback == null || typeof fallback !== "object") {
      snapshot.add({
        stage: "image-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "no-image-fallback-configured",
      } satisfies StageRecord);
      return targets;
    }
    const fb = fallback as Record<string, unknown>;
    const fbProviderId = fb.provider_id;
    const fbBackendModel = fb.backend_model;
    if (typeof fbProviderId !== "string" || typeof fbBackendModel !== "string") {
      snapshot.add({
        stage: "image-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "invalid-fallback-config",
      } satisfies StageRecord);
      return targets;
    }

    // fallback provider 必须存在且 active
    const fbProvider = getProviderById(db, fbProviderId);
    if (!fbProvider || fbProvider.is_active !== 1) {
      snapshot.add({
        stage: "image-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: fbBackendModel,
        redirect_provider: fbProviderId,
        reason: "fallback-provider-unavailable",
      } satisfies StageRecord);
      return targets;
    }

    // prepend fallback target
    const fbTarget: Target = {
      provider_id: fbProviderId,
      backend_model: fbBackendModel,
    };

    snapshot.add({
      stage: "image-redirect",
      triggered: true,
      original_model: firstTarget.backend_model,
      redirect_to: fbBackendModel,
      redirect_provider: fbProviderId,
      reason: "first-target-lacks-image-capability",
    } satisfies StageRecord);

    return [fbTarget, ...targets];
  } catch {
  // 异常安全：返回原始 targets
    return targets;
  }
}
