/**
 * MRL（Modality Redirect）预计算层
 *
 * 纯函数：检测请求体是否包含多模态内容（图片、音频等），若首 target 不支持
 * 且配置了 multimodal_fallback，则将 fallback target prepend 到列表头部。
 */
import type Database from "better-sqlite3";
import type { Target } from "../../core/types.js";
import { PipelineSnapshot, type StageRecord } from "../pipeline-snapshot.js";
import { getProviderById } from "../../db/providers.js";
import { getMappingGroup } from "../../db/mappings.js";
import { parseModels } from "../../config/model-context.js";

// ---------- detectModalities ----------

/**
 * 检测请求体包含的多模态类型，支持三种 API 格式：
 * 1. OpenAI: messages[].content 为数组，检测 type="image_url"|"input_audio"
 * 2. Anthropic: messages[].content[] 含 type="image"（包括嵌套在 tool_result.content[] 中）
 * 3. Responses API: input[] 含 type="input_image"|"input_audio"（顶层或嵌套在 message content 中）
 *
 * 返回检测到的模态 Set（空 Set 表示无多模态内容）。
 */
export function detectModalities(body: Record<string, unknown>): Set<string> {
  const modalities = new Set<string>();

  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (msg == null || typeof msg !== "object") continue;
      const content = (msg as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block == null || typeof block !== "object") continue;
        const rec = block as Record<string, unknown>;
        const t = rec.type;
        if (t === "image_url") modalities.add("image");
        if (t === "input_audio") modalities.add("audio");
        if (t === "image") modalities.add("image");
        // Anthropic tool_result 内嵌: type="tool_result" → content[] 可能含 image
        if (t === "tool_result") {
          const inner = rec.content;
          if (Array.isArray(inner)) {
            for (const ib of inner) {
              if (ib == null || typeof ib !== "object") continue;
              if ((ib as Record<string, unknown>).type === "image") modalities.add("image");
            }
          }
        }
      }
    }
  }

  // Responses API: input[]
  const input = body.input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item == null || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (rec.type === "input_image") modalities.add("image");
      if (rec.type === "input_audio") modalities.add("audio");
      // 嵌套在 message 的 content 中
      const content = rec.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block == null || typeof block !== "object") continue;
          const bt = (block as Record<string, unknown>).type;
          if (bt === "input_image") modalities.add("image");
          if (bt === "input_audio") modalities.add("audio");
        }
      }
    }
  }

  return modalities;
}

// ---------- computeModalityRedirectTargets ----------

/** 判断模型 capabilities 是否包含指定 modality */
function supportsModality(capabilities: string[] | undefined, modality: string): boolean {
  return Array.isArray(capabilities) && capabilities.includes(modality);
}

/**
 * MRL 层主函数。异常安全：任何内部错误均 catch 并返回原始 targets。
 */
export function computeModalityRedirectTargets(
  db: Database.Database,
  targets: Target[],
  clientModel: string,
  body: Record<string, unknown>,
  snapshot: PipelineSnapshot,
): Target[] {
  try {
  // 空列表直接返回
    if (targets.length === 0) return targets;

    // 检测多模态内容
    const modalities = detectModalities(body);

    // 无多模态内容 → no-op
    if (modalities.size === 0) {
      snapshot.add({
        stage: "modality-redirect",
        triggered: false,
        original_model: targets[0].backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "no-multimodal-detected",
      } satisfies StageRecord);
      return targets;
    }

    // 检查首 target 的 provider 是否已支持所有检测到的模态
    const firstTarget = targets[0];
    const provider = getProviderById(db, firstTarget.provider_id);
    if (provider) {
      const entries = parseModels(provider.models);
      const entry = entries.find(e => e.name === firstTarget.backend_model);
      const firstTargetCapabilities = entry?.capabilities ?? [];
      const allSupported = [...modalities].every(m => supportsModality(firstTargetCapabilities, m));
      if (allSupported) {
        snapshot.add({
          stage: "modality-redirect",
          triggered: false,
          original_model: firstTarget.backend_model,
          redirect_to: "",
          redirect_provider: "",
          reason: "first-target-supports-all-modalities",
        } satisfies StageRecord);
        return targets;
      }
    }

    // 查找 multimodal_fallback 配置
    const group = getMappingGroup(db, clientModel);
    if (!group) {
      snapshot.add({
        stage: "modality-redirect",
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
        stage: "modality-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "rule-parse-error",
      } satisfies StageRecord);
      return targets;
    }

    const fallback = rule.multimodal_fallback;
    if (fallback == null || typeof fallback !== "object") {
      snapshot.add({
        stage: "modality-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: "",
        redirect_provider: "",
        reason: "no-multimodal-fallback-configured",
      } satisfies StageRecord);
      return targets;
    }
    const fb = fallback as Record<string, unknown>;
    const fbProviderId = fb.provider_id;
    const fbBackendModel = fb.backend_model;
    if (typeof fbProviderId !== "string" || typeof fbBackendModel !== "string") {
      snapshot.add({
        stage: "modality-redirect",
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
        stage: "modality-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: fbBackendModel,
        redirect_provider: fbProviderId,
        reason: "fallback-provider-unavailable",
      } satisfies StageRecord);
      return targets;
    }

    // 检查 fallback model 是否覆盖所有首 target 缺失的模态
    const firstTargetCapabilities = provider
      ? parseModels(provider.models).find(e => e.name === firstTarget.backend_model)?.capabilities ?? []
      : [];
    const missingModalities = [...modalities].filter(m => !supportsModality(firstTargetCapabilities, m));
    const fbEntry = parseModels(fbProvider.models).find(e => e.name === fbBackendModel);
    const fbCapabilities = fbEntry?.capabilities ?? [];
    const fbMissing = missingModalities.filter(m => !supportsModality(fbCapabilities, m));
    if (fbMissing.length > 0) {
      snapshot.add({
        stage: "modality-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: fbBackendModel,
        redirect_provider: fbProviderId,
        reason: "fallback-missing-modality",
        detected_modalities: [...modalities],
      } satisfies StageRecord);
      return targets;
    }

    // prepend fallback target（如果与首 target 相同则跳过，避免重复消耗 failover 迭代）
    if (fbProviderId === firstTarget.provider_id && fbBackendModel === firstTarget.backend_model) {
      snapshot.add({
        stage: "modality-redirect",
        triggered: false,
        original_model: firstTarget.backend_model,
        redirect_to: fbBackendModel,
        redirect_provider: fbProviderId,
        reason: "fallback-same-as-first-target",
        detected_modalities: [...modalities],
      } satisfies StageRecord);
      return targets;
    }

    const fbTarget: Target = {
      provider_id: fbProviderId,
      backend_model: fbBackendModel,
    };

    snapshot.add({
      stage: "modality-redirect",
      triggered: true,
      original_model: firstTarget.backend_model,
      redirect_to: fbBackendModel,
      redirect_provider: fbProviderId,
      reason: "first-target-lacks-modality",
      detected_modalities: [...modalities],
    } satisfies StageRecord);

    return [fbTarget, ...targets];
  } catch (err: unknown) {
  // 异常安全：返回原始 targets，但记录诊断信息
    console.error('computeModalityRedirectTargets: internal error, falling back to original targets', err);
    snapshot.add({
      stage: "modality-redirect",
      triggered: false,
      original_model: targets[0]?.backend_model ?? "",
      redirect_to: "",
      redirect_provider: "",
      reason: "internal-error",
    } satisfies StageRecord);
    return targets;
  }
}
