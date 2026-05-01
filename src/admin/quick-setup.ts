import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { createProvider } from "../db/providers.js";
import { createMappingGroup } from "../db/mappings.js";
import { createRetryRule } from "../db/retry-rules.js";
import { encrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { HTTP_CREATED, HTTP_BAD_REQUEST, HTTP_CONFLICT } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";
import { PROVIDER_CONCURRENCY_DEFAULTS } from "../db/providers.js";
import type { StateRegistry } from "../core/registry.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import type { AdaptiveConcurrencyController } from "../proxy/adaptive-controller.js";

const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const API_KEY_PREVIEW_MIN_LENGTH = 8;
const API_KEY_PREVIEW_PREFIX_LEN = 4;

const QuickSetupProviderSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  api_type: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
  base_url: Type.String({ minLength: 1 }),
  api_key: Type.String({ minLength: 1 }),
  models: Type.Array(Type.Object({
    name: Type.String(),
    context_window: Type.Optional(Type.Number()),
    patches: Type.Optional(Type.Array(Type.String())),
  })),
});

const QuickSetupMappingSchema = Type.Object({
  client_model: Type.String({ minLength: 1 }),
  backend_model: Type.String({ minLength: 1 }),
});

const QuickSetupRetryRuleSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  status_code: Type.Number({ minimum: 100, maximum: 599 }),
  body_pattern: Type.String({ minLength: 1 }),
  retry_strategy: Type.Union([Type.Literal("fixed"), Type.Literal("exponential")]),
  retry_delay_ms: Type.Number({ minimum: 100 }),
  max_retries: Type.Number({ minimum: 0, maximum: 100 }),
  max_delay_ms: Type.Number({ minimum: 100 }),
});

const QuickSetupSchema = Type.Object({
  provider: QuickSetupProviderSchema,
  mappings: Type.Array(QuickSetupMappingSchema),
  retry_rules: Type.Array(QuickSetupRetryRuleSchema),
});

interface QuickSetupRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
  tracker?: RequestTracker;
  adaptiveController?: AdaptiveConcurrencyController;
}

export const adminQuickSetupRoutes: FastifyPluginCallback<QuickSetupRoutesOptions> = (app, options, done) => {
  const { db, stateRegistry, tracker, adaptiveController } = options;

  app.post("/admin/api/quick-setup", { schema: { body: QuickSetupSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof QuickSetupSchema>;

    // 1. Validate provider name
    if (!PROVIDER_NAME_RE.test(body.provider.name)) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.VALIDATION_FAILED, "Provider 名称仅允许英文大小写字母、数字、横线和下划线"));
    }

    // 2. Check no duplicate provider name
    const existing = db.prepare("SELECT id FROM providers WHERE name = ?").get(body.provider.name) as { id: string } | undefined;
    if (existing) {
      return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_NAME, `Provider 名称 '${body.provider.name}' 已存在`));
    }

    // 3. Validate retry rule body_pattern regex
    for (const rule of body.retry_rules) {
      try {
        new RegExp(rule.body_pattern);
      } catch {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.INVALID_REGEX, `重试规则「${rule.name}」的 body_pattern 不是有效的正则表达式`));
      }
    }

    // 4. Start transaction
    const encryptionKey = getSetting(db, "encryption_key")!;

    const createAll = db.transaction(() => {
      // 5. Create provider with models JSON
      const encryptedKey = encrypt(body.provider.api_key, encryptionKey);
      const modelEntries = body.provider.models.map(m => ({
        name: m.name,
        ...(m.context_window != null ? { context_window: m.context_window } : {}),
        ...(m.patches && m.patches.length > 0 ? { patches: m.patches } : {}),
      }));
      const providerId = createProvider(db, {
        name: body.provider.name,
        api_type: body.provider.api_type,
        base_url: body.provider.base_url,
        api_key: encryptedKey,
        api_key_preview: body.provider.api_key.length > API_KEY_PREVIEW_MIN_LENGTH
          ? `${body.provider.api_key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${body.provider.api_key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}`
          : "****",
        models: JSON.stringify(modelEntries),
        is_active: 1,
        max_concurrency: PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
        queue_timeout_ms: PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
        max_queue_size: PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
        adaptive_enabled: 0,
      });

      // 6. Create mapping groups
      for (const m of body.mappings) {
        createMappingGroup(db, {
          client_model: m.client_model,
          rule: JSON.stringify({
            targets: [{ backend_model: m.backend_model, provider_id: providerId }],
          }),
        });
      }

      // 7. Create retry rules
      for (const r of body.retry_rules) {
        createRetryRule(db, {
          name: r.name,
          status_code: r.status_code,
          body_pattern: r.body_pattern,
          is_active: 1,
          retry_strategy: r.retry_strategy,
          retry_delay_ms: r.retry_delay_ms,
          max_retries: r.max_retries,
          max_delay_ms: r.max_delay_ms,
        });
      }

      return providerId;
    });

    // 8. Execute transaction
    const providerId = createAll();

    // 9. Sync concurrency state
    adaptiveController?.syncProvider(providerId, {
      adaptive_enabled: 0,
      max_concurrency: PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queue_timeout_ms: PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      max_queue_size: PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
    });
    tracker?.updateProviderConfig(providerId, {
      name: body.provider.name,
      maxConcurrency: PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
      queueTimeoutMs: PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
      maxQueueSize: PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
    });

    return reply.code(HTTP_CREATED).send({ success: true, provider_id: providerId });
  });

  done();
};
