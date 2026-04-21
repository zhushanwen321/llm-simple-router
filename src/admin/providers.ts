import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import type { Provider } from "../db/index.js";
import { getAllProviders, getProviderById, createProvider, updateProvider, deleteProvider, getAllMappingGroups, PROVIDER_CONCURRENCY_DEFAULTS } from "../db/index.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { ProviderSemaphoreManager } from "../proxy/semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_BAD_REQUEST } from "./constants.js";

const API_KEY_PREVIEW_MIN_LENGTH = 8;
const API_KEY_PREVIEW_PREFIX_LEN = 4;

const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const CreateProviderSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  api_type: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
  base_url: Type.String({ minLength: 1 }),
  api_key: Type.String({ minLength: 1 }),
  models: Type.Optional(Type.Array(Type.String())),
  is_active: Type.Optional(Type.Number()),
  max_concurrency: Type.Optional(Type.Integer({ minimum: 0 })),
  queue_timeout_ms: Type.Optional(Type.Integer({ minimum: 0 })),
  max_queue_size: Type.Optional(Type.Integer({ minimum: 1 })),
});

const UpdateProviderSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  api_type: Type.Optional(Type.Union([Type.Literal("openai"), Type.Literal("anthropic")])),
  base_url: Type.Optional(Type.String({ minLength: 1 })),
  api_key: Type.Optional(Type.String({ minLength: 1 })),
  models: Type.Optional(Type.Array(Type.String())),
  is_active: Type.Optional(Type.Number()),
  max_concurrency: Type.Optional(Type.Integer({ minimum: 0 })),
  queue_timeout_ms: Type.Optional(Type.Integer({ minimum: 0 })),
  max_queue_size: Type.Optional(Type.Integer({ minimum: 1 })),
});

interface ProviderRoutesOptions {
  db: Database.Database;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
}

export const adminProviderRoutes: FastifyPluginCallback<ProviderRoutesOptions> = (app, options, done) => {
  const { db, semaphoreManager, tracker } = options;

  app.get("/admin/api/providers", async (_request, reply) => {
    const encryptionKey = getSetting(db, "encryption_key")!;
    const providers = getAllProviders(db);
    return reply.send(providers.map((s) => ({
      id: s.id,
      name: s.name,
      api_type: s.api_type,
      base_url: s.base_url,
      api_key: s.api_key ? decrypt(s.api_key, encryptionKey) : "",
      models: JSON.parse(s.models || "[]"),
      is_active: s.is_active,
      max_concurrency: s.max_concurrency,
      queue_timeout_ms: s.queue_timeout_ms,
      max_queue_size: s.max_queue_size,
      concurrency_status: semaphoreManager?.getStatus(s.id) ?? { active: 0, queued: 0 },
      created_at: s.created_at,
      updated_at: s.updated_at,
    })));
  });

  app.post("/admin/api/providers", { schema: { body: CreateProviderSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateProviderSchema>;
    if (!PROVIDER_NAME_RE.test(body.name)) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: { message: "Provider 名称仅允许英文大小写字母、数字、横线和下划线" } });
    }
    const encryptedKey = encrypt(body.api_key, getSetting(db, "encryption_key")!);
    const id = createProvider(db, {
      name: body.name,
      api_type: body.api_type,
      base_url: body.base_url,
      api_key: encryptedKey,
      api_key_preview: body.api_key.length > API_KEY_PREVIEW_MIN_LENGTH ? `${body.api_key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${body.api_key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}` : "****",
      models: JSON.stringify(body.models ?? []),
      is_active: body.is_active ?? 1,
      max_concurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queue_timeout_ms: body.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      max_queue_size: body.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
    });
    semaphoreManager?.updateConfig(id, {
      maxConcurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queueTimeoutMs: body.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      maxQueueSize: body.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
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
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Provider not found" } });
    }
    const body = request.body as Static<typeof UpdateProviderSchema>;
    if (body.name !== undefined && !PROVIDER_NAME_RE.test(body.name)) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: { message: "Provider 名称仅允许英文大小写字母、数字、横线和下划线" } });
    }
    const fields: Partial<Pick<Provider, 'name' | 'api_type' | 'base_url' | 'api_key' | 'api_key_preview' | 'models' | 'is_active' | 'max_concurrency' | 'queue_timeout_ms' | 'max_queue_size'>> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.api_type !== undefined) fields.api_type = body.api_type;
    if (body.base_url !== undefined) fields.base_url = body.base_url;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    if (body.models !== undefined) fields.models = JSON.stringify(body.models);
    if (body.max_concurrency !== undefined) fields.max_concurrency = body.max_concurrency;
    if (body.queue_timeout_ms !== undefined) fields.queue_timeout_ms = body.queue_timeout_ms;
    if (body.max_queue_size !== undefined) fields.max_queue_size = body.max_queue_size;
    if (body.api_key) {
      fields.api_key = encrypt(body.api_key, getSetting(db, "encryption_key")!);
      fields.api_key_preview = body.api_key.length > API_KEY_PREVIEW_MIN_LENGTH ? `${body.api_key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${body.api_key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}` : "****";
    }
    updateProvider(db, id, fields);
    const updated = getProviderById(db, id)!;
    if (body.max_concurrency !== undefined || body.queue_timeout_ms !== undefined || body.max_queue_size !== undefined) {
      semaphoreManager?.updateConfig(id, {
        maxConcurrency: updated.max_concurrency,
        queueTimeoutMs: updated.queue_timeout_ms,
        maxQueueSize: updated.max_queue_size,
      });
    }
    tracker?.updateProviderConfig(id, {
      name: body.name ?? existing.name,
      maxConcurrency: updated.max_concurrency,
      queueTimeoutMs: updated.queue_timeout_ms,
      maxQueueSize: updated.max_queue_size,
    });
    return reply.send({ success: true });
  });

  app.delete("/admin/api/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const groups = getAllMappingGroups(db);
    for (const g of groups) {
      try {
        const rule = JSON.parse(g.rule);
        const targets = [rule.default, ...(rule.windows || [])].filter(Boolean);
        if (targets.some((t: { provider_id: string }) => t.provider_id === id)) {
          return reply.code(HTTP_CONFLICT).send({ error: { message: `Provider is referenced by mapping group '${g.client_model}'` } });
        }
      } catch { continue }
    }
    deleteProvider(db, id);
    semaphoreManager?.remove(id);
    tracker?.removeProviderConfig(id);
    return reply.send({ success: true });
  });

  done();
};
