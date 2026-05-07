import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import type { Provider } from "../db/index.js";
import { getAllProviders, getProviderById, createProvider, updateProvider, deleteProvider, getAllMappingGroups, updateMappingGroup, PROVIDER_CONCURRENCY_DEFAULTS } from "../db/index.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import type { StateRegistry } from "../core/registry.js";
import type { AdaptiveController } from "@llm-router/core/concurrency";
import type { RequestTracker } from "@llm-router/core/monitor";
import type { ProxyAgentFactory } from "../proxy/transport/proxy-agent.js";
import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_BAD_REQUEST, HTTP_OK } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";
import { parseModels, buildModelInfoList, type ModelEntry } from "../config/model-context.js";
import { getModelInfoForProvider, setModelInfoForProvider, deleteAllModelInfoForProvider } from "../db/model-info.js";
import { buildUpstreamHeaders } from "../proxy/proxy-core.js";
import { callGet } from "../proxy/transport/http.js";

const API_KEY_PREVIEW_MIN_LENGTH = 8;
const FETCH_MODELS_BODY_PREVIEW_LENGTH = 200;

interface CascadeResult {
  updatedGroups: Array<{ id: string; client_model: string; disabled: boolean }>;
}

function cascadeProviderDisable(db: Database.Database, providerId: string): CascadeResult {
  const result: CascadeResult = { updatedGroups: [] };
  const groups = getAllMappingGroups(db);

  for (const g of groups) {
    if (!g.is_active) continue;

    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(g.rule) as Record<string, unknown>;
    } catch { continue }

    let modified = false;
    let shouldDisable = false;

    // 归一化旧格式 { default, windows } → { targets }（向后兼容 migration 026 前数据）
    // eslint-disable-next-line taste/no-deprecated-rule-format
    if (!Array.isArray(rule.targets) && typeof rule.default === "object" && rule.default !== null) {
      // eslint-disable-next-line taste/no-deprecated-rule-format
      rule.targets = [rule.default];
    }

    const targets = rule.targets as Array<Record<string, string>> | undefined;
    if (Array.isArray(targets)) {
      const filtered = targets.filter((t) => {
        if (t.provider_id === providerId) {
          modified = true;
          return false;
        }
        if (t.overflow_provider_id === providerId) {
          delete t.overflow_provider_id;
          delete t.overflow_model;
          modified = true;
        }
        return true;
      });
      rule.targets = filtered;
      if (filtered.length === 0 && modified) {
        shouldDisable = true;
      }
    }

    if (modified) {
      const fields: { rule: string; is_active?: number } = { rule: JSON.stringify(rule) };
      if (shouldDisable) fields.is_active = 0;
      updateMappingGroup(db, g.id, fields);
      result.updatedGroups.push({ id: g.id, client_model: g.client_model, disabled: shouldDisable });
    }
  }

  return result;
}

type ModelInput = string | { name?: string; id?: string; context_window?: number; patches?: string[]; stream_timeout_ms?: number };

interface ModelOverride {
  name: string;
  context_window: number;
}

function extractModelOverrides(models: ModelInput[]): {
  entries: ModelEntry[];
  overrides: ModelOverride[];
} {
  const entries: ModelEntry[] = [];
  const overrides: ModelOverride[] = [];
  for (const m of models) {
    if (typeof m === "string") {
      entries.push({ name: m, patches: [] });
      continue;
    }
    const name = m.name ?? m.id;
    if (!name) continue;
    const entry: ModelEntry = { name, patches: m.patches ?? [] };
    if (m.stream_timeout_ms != null) entry.stream_timeout_ms = m.stream_timeout_ms;
    entries.push(entry);
    if (m.name != null && m.context_window != null) {
      overrides.push({ name: m.name, context_window: m.context_window });
    }
  }
  return { entries, overrides };
}
const API_KEY_PREVIEW_PREFIX_LEN = 4;

const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const CreateProviderSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  api_type: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
  base_url: Type.String({ minLength: 1 }),
  upstream_path: Type.Optional(Type.String({ minLength: 1 })),
  api_key: Type.String({ minLength: 1 }),
  models: Type.Optional(Type.Array(Type.Union([
    Type.String(),
    Type.Object({ name: Type.String(), context_window: Type.Optional(Type.Number()), patches: Type.Optional(Type.Array(Type.String())), stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 })) }),
    Type.Object({ id: Type.String(), stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 })) })
  ]))),
  is_active: Type.Optional(Type.Number()),
  max_concurrency: Type.Optional(Type.Integer({ minimum: 0 })),
  queue_timeout_ms: Type.Optional(Type.Integer({ minimum: 0 })),
  max_queue_size: Type.Optional(Type.Integer({ minimum: 1 })),
  adaptive_enabled: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
  proxy_type: Type.Optional(Type.Union([Type.Literal("http"), Type.Literal("socks5"), Type.Null()])),
  proxy_url: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  proxy_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  proxy_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const UpdateProviderSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  api_type: Type.Optional(Type.Union([Type.Literal("openai"), Type.Literal("anthropic")])),
  base_url: Type.Optional(Type.String({ minLength: 1 })),
  upstream_path: Type.Optional(Type.String({ minLength: 1 })),
  api_key: Type.Optional(Type.String({ minLength: 1 })),
  models: Type.Optional(Type.Array(Type.Union([
    Type.String(),
    Type.Object({ name: Type.String(), context_window: Type.Optional(Type.Number()), patches: Type.Optional(Type.Array(Type.String())), stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 })) }),
    Type.Object({ id: Type.String(), stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 })) })
  ]))),
  is_active: Type.Optional(Type.Number()),
  max_concurrency: Type.Optional(Type.Integer({ minimum: 0 })),
  queue_timeout_ms: Type.Optional(Type.Integer({ minimum: 0 })),
  max_queue_size: Type.Optional(Type.Integer({ minimum: 1 })),
  adaptive_enabled: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
  proxy_type: Type.Optional(Type.Union([Type.Literal("http"), Type.Literal("socks5"), Type.Null()])),
  proxy_url: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  proxy_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  proxy_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

interface ProviderRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
  tracker?: RequestTracker;
  adaptiveController?: AdaptiveController;
  proxyAgentFactory?: ProxyAgentFactory;
}

export const adminProviderRoutes: FastifyPluginCallback<ProviderRoutesOptions> = (app, options, done) => {
  const { db, stateRegistry, tracker, adaptiveController, proxyAgentFactory } = options;

  app.get("/admin/api/providers", async (_request, reply) => {
    const encryptionKey = getSetting(db, "encryption_key")!;
    const providers = getAllProviders(db);
    return reply.send(providers.map((s) => {
      const modelEntries = parseModels(s.models || "[]");
      const overrides = new Map(
        getModelInfoForProvider(db, s.id).map(m => [m.model_name, m.context_window]),
      );
      return {
        id: s.id,
        name: s.name,
        api_type: s.api_type,
        base_url: s.base_url,
        api_key: s.api_key ? decrypt(s.api_key, encryptionKey) : "",
        models: buildModelInfoList(modelEntries, overrides),
        is_active: s.is_active,
        max_concurrency: s.max_concurrency,
        queue_timeout_ms: s.queue_timeout_ms,
        max_queue_size: s.max_queue_size,
        adaptive_enabled: s.adaptive_enabled,
        proxy_type: s.proxy_type,
        proxy_url: s.proxy_url,
        proxy_username: s.proxy_username ? decrypt(s.proxy_username, encryptionKey) : null,
        proxy_password: s.proxy_password ? decrypt(s.proxy_password, encryptionKey) : null,
        concurrency_status: stateRegistry?.getProviderStatus(s.id) ?? { active: 0, queued: 0 },
        created_at: s.created_at,
        updated_at: s.updated_at,
      };
    }));
  });

  app.post("/admin/api/providers", { schema: { body: CreateProviderSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateProviderSchema>;
    if (!PROVIDER_NAME_RE.test(body.name)) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.VALIDATION_FAILED, "Provider 名称仅允许英文大小写字母、数字、横线和下划线"));
    }
    const existing = db.prepare("SELECT id FROM providers WHERE name = ?").get(body.name) as { id: string } | undefined;
    if (existing) {
      return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_NAME, `Provider 名称 '${body.name}' 已存在`));
    }
    const encryptedKey = encrypt(body.api_key, getSetting(db, "encryption_key")!);
    const { entries: normalizedModels, overrides: contextOverrides } = extractModelOverrides((body.models ?? []) as ModelInput[]);
    const isAdaptiveEnabled = body.adaptive_enabled ?? 0;

    // 将空 proxy_url 视为不使用代理
    const effectiveProxyType = body.proxy_url?.trim() ? body.proxy_type : null;
    const effectiveProxyUrl = body.proxy_url?.trim() || null;

    const encryptedProxyUsername = (effectiveProxyType && body.proxy_username) ? encrypt(body.proxy_username, getSetting(db, "encryption_key")!) : null;
    const encryptedProxyPassword = (effectiveProxyType && body.proxy_password) ? encrypt(body.proxy_password, getSetting(db, "encryption_key")!) : null;
    const id = createProvider(db, {
      name: body.name,
      api_type: body.api_type,
      base_url: body.base_url,
      upstream_path: body.upstream_path ?? null,
      api_key: encryptedKey,
      api_key_preview: body.api_key.length > API_KEY_PREVIEW_MIN_LENGTH ? `${body.api_key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${body.api_key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}` : "****",
      models: JSON.stringify(normalizedModels),
      is_active: body.is_active ?? 1,
      max_concurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queue_timeout_ms: body.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      max_queue_size: body.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
      adaptive_enabled: isAdaptiveEnabled,
      proxy_type: effectiveProxyType,
      proxy_url: effectiveProxyUrl,
      proxy_username: encryptedProxyUsername,
      proxy_password: encryptedProxyPassword,
    });
    if (contextOverrides.length > 0) {
      setModelInfoForProvider(db, id, contextOverrides.map(o => ({ model_name: o.name, context_window: o.context_window })));
    }
    // 当 adaptive 启用时，由 syncProvider 全权管理信号量（避免重复调用 updateConfig）
    if (!isAdaptiveEnabled) {
      stateRegistry?.updateProviderConcurrency(id, {
        maxConcurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
        queueTimeoutMs: body.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
        maxQueueSize: body.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
      });
    }
    adaptiveController?.syncProvider(id, {
      adaptive_enabled: isAdaptiveEnabled,
      max_concurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queue_timeout_ms: body.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      max_queue_size: body.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
    });
    tracker?.updateProviderConfig(id, {
      name: body.name,
      maxConcurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queueTimeoutMs: body.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      maxQueueSize: body.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
    });
    return reply.code(HTTP_CREATED).send({ id });
  });

  app.put("/admin/api/providers/:id", { schema: { body: UpdateProviderSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getProviderById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Provider not found"));
    }
    const body = request.body as Static<typeof UpdateProviderSchema>;
    if (body.name !== undefined && !PROVIDER_NAME_RE.test(body.name)) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.VALIDATION_FAILED, "Provider 名称仅允许英文大小写字母、数字、横线和下划线"));
    }
    const fields: Partial<Pick<Provider, 'name' | 'api_type' | 'base_url' | 'upstream_path' | 'api_key' | 'api_key_preview' | 'models' | 'is_active' | 'max_concurrency' | 'queue_timeout_ms' | 'max_queue_size' | 'adaptive_enabled' | 'proxy_type' | 'proxy_url' | 'proxy_username' | 'proxy_password'>> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.api_type !== undefined) fields.api_type = body.api_type;
    if (body.base_url !== undefined) fields.base_url = body.base_url;
    if (body.upstream_path !== undefined) fields.upstream_path = body.upstream_path || null;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    if (body.models !== undefined) {
      const { entries, overrides } = extractModelOverrides(body.models as ModelInput[]);
      fields.models = JSON.stringify(entries);
      if (overrides.length > 0) {
        setModelInfoForProvider(db, id, overrides.map(o => ({ model_name: o.name, context_window: o.context_window })));
      } else {
        deleteAllModelInfoForProvider(db, id);
      }
    }
    if (body.max_concurrency !== undefined) fields.max_concurrency = body.max_concurrency;
    if (body.queue_timeout_ms !== undefined) fields.queue_timeout_ms = body.queue_timeout_ms;
    if (body.max_queue_size !== undefined) fields.max_queue_size = body.max_queue_size;
    if (body.adaptive_enabled !== undefined) fields.adaptive_enabled = body.adaptive_enabled;
    if (body.api_key) {
      fields.api_key = encrypt(body.api_key, getSetting(db, "encryption_key")!);
      fields.api_key_preview = body.api_key.length > API_KEY_PREVIEW_MIN_LENGTH ? `${body.api_key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${body.api_key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}` : "****";
    }
    // Proxy field handling - 空URL视为不使用代理
    const effectiveProxyUrl = body.proxy_url !== undefined ? (body.proxy_url?.trim() || null) : undefined;
    const effectiveProxyType = effectiveProxyUrl !== undefined ? (effectiveProxyUrl ? body.proxy_type : null) : undefined;

    if (effectiveProxyType !== undefined) {
      fields.proxy_type = effectiveProxyType;
      fields.proxy_url = effectiveProxyUrl;
      if (!effectiveProxyType) {
        fields.proxy_username = null;
        fields.proxy_password = null;
      }
    }
    if (body.proxy_username !== undefined && effectiveProxyType) {
      fields.proxy_username = body.proxy_username ? encrypt(body.proxy_username, getSetting(db, "encryption_key")!) : null;
    }
    if (body.proxy_password !== undefined && effectiveProxyType) {
      fields.proxy_password = body.proxy_password ? encrypt(body.proxy_password, getSetting(db, "encryption_key")!) : null;
    }
    updateProvider(db, id, fields);
    proxyAgentFactory?.invalidate(id);
    const updated = getProviderById(db, id)!;

    let cascade: CascadeResult | undefined;
    if (existing.is_active === 1 && body.is_active === 0) {
      cascade = cascadeProviderDisable(db, id);
      // 禁用时清理信号量和自适应并发，避免排队请求悬挂
      stateRegistry?.removeProvider(id);
      adaptiveController?.remove(id);
    }

    // 重新启用时重建信号量和自适应并发
    const concurrencyChanged = body.max_concurrency !== undefined || body.queue_timeout_ms !== undefined || body.max_queue_size !== undefined;
    const adaptiveChanged = body.adaptive_enabled !== undefined;
    const reenabled = existing.is_active === 0 && body.is_active === 1;
    const needsSync = concurrencyChanged || adaptiveChanged || reenabled;

    if (needsSync) {
      // adaptive 同步：syncProvider 内部根据 adaptive_enabled 决定是 init+syncToSemaphore 还是 remove+updateConfig
      adaptiveController?.syncProvider(id, {
        adaptive_enabled: updated.adaptive_enabled,
        max_concurrency: updated.max_concurrency,
        queue_timeout_ms: updated.queue_timeout_ms,
        max_queue_size: updated.max_queue_size,
      });
      // 非 adaptive 模式下手动同步信号量（adaptive 启用时由 syncProvider 内部管理）
      if (!updated.adaptive_enabled) {
        stateRegistry?.updateProviderConcurrency(id, {
          maxConcurrency: updated.max_concurrency,
          queueTimeoutMs: updated.queue_timeout_ms,
          maxQueueSize: updated.max_queue_size,
        });
      }
    }
    tracker?.updateProviderConfig(id, {
      name: body.name ?? existing.name,
      maxConcurrency: updated.max_concurrency,
      queueTimeoutMs: updated.queue_timeout_ms,
      maxQueueSize: updated.max_queue_size,
    });
    return reply.send({ success: true, cascadedGroups: cascade?.updatedGroups ?? [] });
  });

  app.get("/admin/api/providers/:id/dependencies", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getProviderById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Provider not found"));
    }

    const references: string[] = [];

    const groups = getAllMappingGroups(db);
    for (const g of groups) {
      if (!g.is_active) continue;
      const refs: string[] = [];
      try {
        const rule = JSON.parse(g.rule);
        if (Array.isArray(rule.targets)) {
          for (let i = 0; i < rule.targets.length; i++) {
            const t = rule.targets[i];
            if (t.provider_id === id) {
              refs.push(`目标 ${i + 1} (${t.backend_model})`);
            }
            if (t.overflow_provider_id === id) {
              refs.push(`目标 ${i + 1} 溢出 (${t.overflow_model || "-"})`);
            }
          }
        }
      } catch { continue }
      for (const ref of refs) {
        references.push(`映射分组「${g.client_model}」: ${ref}`);
      }
    }

    return reply.send({ references });
  });

  app.delete("/admin/api/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getProviderById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Provider not found"));
    }
    const groups = getAllMappingGroups(db);
    for (const g of groups) {
      try {
        const rule = JSON.parse(g.rule);
        const targets = Array.isArray(rule.targets) ? rule.targets : [];
        if (targets.some((t: Record<string, unknown>) => t?.provider_id === id)) {
          return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_REFERENCED, `Provider is referenced by mapping group '${g.client_model}'`));
        }
      } catch { continue }
    }
    proxyAgentFactory?.invalidate(id);
    deleteProvider(db, id);
    stateRegistry?.removeProvider(id);
    adaptiveController?.remove(id);
    tracker?.removeProviderConfig(id);
    return reply.send({ success: true });
  });

  // --- 从上游 Provider 获取可用模型列表 ---
  const FetchModelsSchema = Type.Object({
    base_url: Type.String({ minLength: 1 }),
    models_endpoint: Type.String({ minLength: 1 }),
    api_key: Type.String({ minLength: 1 }),
    api_type: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
  });

  app.post("/admin/api/providers/fetch-models", { schema: { body: FetchModelsSchema } }, async (request, reply) => {
    const { base_url, models_endpoint, api_key, api_type } = request.body as Static<typeof FetchModelsSchema>;

    const backend = { base_url };
    const clientHeaders: Record<string, string> = {};
    try {
      const result = await callGet(
        backend,
        api_key,
        clientHeaders as import("../proxy/types.js").RawHeaders,
        models_endpoint,
        (cliHdrs, key) => buildUpstreamHeaders(cliHdrs, key, undefined, api_type),
      );

      if (result.statusCode !== HTTP_OK) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(
          API_CODE.BAD_REQUEST,
          `上游返回 HTTP ${result.statusCode}: ${result.body.substring(0, FETCH_MODELS_BODY_PREVIEW_LENGTH) as string}`,
        ));
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "上游返回非 JSON 响应"));
      }

      // OpenAI 格式: { object: "list", data: [{ id: "model-name", ... }] }
      // Anthropic 格式: { data: [{ type: "model", id: "model-name", ... }] }
      const data = (parsed as Record<string, unknown>)?.data;
      if (!Array.isArray(data)) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "上游返回的模型列表格式不符合预期"));
      }

      const modelIds = data
        .map((item: unknown) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null && "id" in item) return (item as { id: string }).id;
          return null;
        })
        .filter((id): id is string => typeof id === "string")
        .sort();

      return reply.send(modelIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, `连接上游失败: ${message}`));
    }
  });

  app.get("/admin/api/providers/:id/adaptive-status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const status = adaptiveController?.getStatus(id);
    if (!status) return reply.code(HTTP_NOT_FOUND).send({ error: "Not found or adaptive not enabled" });
    return status;
  });

  done();
};
