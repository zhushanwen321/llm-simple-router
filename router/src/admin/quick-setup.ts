import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { createProvider, PROVIDER_CONCURRENCY_DEFAULTS } from "../db/providers.js";
import { createMappingGroup, updateMappingGroup } from "../db/mappings.js";
import { createRetryRule } from "../db/retry-rules.js";
import { upsertTransformRule } from "../db/transform-rules.js";
import { encrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { getRecommendedProviders, getRecommendedRetryRules } from "../config/recommended.js";
import { lookupCapabilities } from "../config/model-context.js";
import { getAllMappingGroups, getAllProviders } from "../db/index.js";
import { serializeProviders } from "./providers.js";
import { HTTP_CREATED, HTTP_BAD_REQUEST, HTTP_BAD_GATEWAY, HTTP_CONFLICT } from "../core/constants.js";
import { API_CODE, apiError } from "./api-response.js";
import type { StateRegistry } from "../core/registry.js";
import type { RequestTracker } from "../core/monitor/index.js";
import type { AdaptiveController } from "../core/concurrency/index.js";

import { PROVIDER_NAME_RE } from "./utils.js";
const API_KEY_PREVIEW_MIN_LENGTH = 8;
const API_KEY_PREVIEW_PREFIX_LEN = 4;
const NEW_PROVIDER_ID = "__new__";

/** Recursively replace "__new__" provider_id values with the actual provider ID */
function replaceProviderIds(obj: unknown, providerId: string): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => replaceProviderIds(item, providerId));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (
        (key === "provider_id" || key === "overflow_provider_id") &&
        (value === NEW_PROVIDER_ID || value === "")
      ) {
        result[key] = providerId;
      } else {
        result[key] = replaceProviderIds(value, providerId);
      }
    }
    return result;
  }
  return obj;
}

const QuickSetupEndpointSchema = Type.Object({
  api_type: Type.Union([Type.Literal("openai"), Type.Literal("openai-responses"), Type.Literal("anthropic")]),
  base_url: Type.String({ minLength: 1 }),
  upstream_path: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  api_key: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
});

const QuickSetupProviderSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  api_type: Type.Union([Type.Literal("openai"), Type.Literal("openai-responses"), Type.Literal("anthropic")]),
  base_url: Type.String({ minLength: 1 }),
  upstream_path: Type.Optional(Type.String({ minLength: 1 })),
  api_key: Type.String({ minLength: 1 }),
  models: Type.Array(Type.Object({
    name: Type.String(),
    context_window: Type.Optional(Type.Number()),
    patches: Type.Optional(Type.Array(Type.String())),
    stream_timeout_ms: Type.Optional(Type.Number()),
    non_stream_timeout_ms: Type.Optional(Type.Number()),
    capabilities: Type.Optional(Type.Array(Type.String())),
  })),
  endpoints: Type.Optional(Type.Array(QuickSetupEndpointSchema, { minItems: 1 })),
  concurrency_mode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("manual"), Type.Literal("none")])),
  max_concurrency: Type.Optional(Type.Number()),
  queue_timeout_ms: Type.Optional(Type.Number()),
  max_queue_size: Type.Optional(Type.Number()),
});

const QuickSetupMappingSchema = Type.Object({
  client_model: Type.String({ minLength: 1 }),
  backend_model: Type.String({ minLength: 1 }),
  /** Optional pre-built rule JSON (targets, overflow, multimodal_fallback).
   *  If provided, provider_id fields are replaced with the newly created provider's ID. */
  rule: Type.Optional(Type.String({ minLength: 1 })),
});

const QuickSetupRetryRuleSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  status_code: Type.Number({ minimum: 100, maximum: 599 }),
  body_pattern: Type.String({ minLength: 1 }),
  retry_strategy: Type.Union([Type.Literal("fixed"), Type.Literal("exponential")]),
  retry_delay_ms: Type.Number({ minimum: 100 }),
  max_retries: Type.Number({ minimum: 0, maximum: 100 }),
  max_delay_ms: Type.Number({ minimum: 100 }),
  provider_shortname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const QuickSetupTransformSchema = Type.Object({
  inject_headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  request_defaults: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  drop_fields: Type.Optional(Type.Array(Type.String())),
});

const QuickSetupSchema = Type.Object({
  provider: QuickSetupProviderSchema,
  mappings: Type.Array(QuickSetupMappingSchema),
  retry_rules: Type.Array(QuickSetupRetryRuleSchema),
  transform_rules: Type.Optional(QuickSetupTransformSchema),
});

interface QuickSetupRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
  tracker?: RequestTracker;
  adaptiveController?: AdaptiveController;
}

export const adminQuickSetupRoutes: FastifyPluginCallback<QuickSetupRoutesOptions> = (app, options, done) => {
  const { db, tracker, adaptiveController } = options;

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
        ...(m.stream_timeout_ms != null ? { stream_timeout_ms: m.stream_timeout_ms } : {}),
        ...(m.non_stream_timeout_ms != null ? { non_stream_timeout_ms: m.non_stream_timeout_ms } : {}),
        ...(m.capabilities && m.capabilities.length > 0 ? { capabilities: m.capabilities } : {}),
      }));
      const adaptiveEnabled = body.provider.concurrency_mode === 'auto' ? 1 : 0;
      const maxConcurrency = body.provider.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency;
      const queueTimeoutMs = body.provider.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms;
      const maxQueueSize = body.provider.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size;

      const providerId = createProvider(db, {
        name: body.provider.name,
        api_type: body.provider.api_type,
        base_url: body.provider.base_url,
        upstream_path: body.provider.upstream_path ?? null,
        api_key: encryptedKey,
        api_key_preview: body.provider.api_key.length > API_KEY_PREVIEW_MIN_LENGTH
          ? `${body.provider.api_key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${body.provider.api_key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}`
          : "****",
        models: JSON.stringify(modelEntries),
        is_active: 1,
        max_concurrency: maxConcurrency,
        queue_timeout_ms: queueTimeoutMs,
        max_queue_size: maxQueueSize,
        adaptive_enabled: adaptiveEnabled,
        ...(body.provider.endpoints && body.provider.endpoints.length > 0
          ? {
            endpoints: JSON.stringify(body.provider.endpoints.map(ep => ({
              api_type: ep.api_type,
              base_url: ep.base_url,
              upstream_path: ep.upstream_path ?? null,
              api_key: ep.api_key ? encrypt(ep.api_key, encryptionKey) : (body.provider.api_key ? encrypt(body.provider.api_key, encryptionKey) : null),
            }))),
          }
          : {}),
      });

      // 6. Upsert mapping groups
      for (const m of body.mappings) {
        const existing = db.prepare('SELECT id FROM mapping_groups WHERE client_model = ?').get(m.client_model) as { id: string } | undefined;
        let ruleJson: string;
        if (m.rule) {
          // Replace provider_id placeholders with the newly created provider's ID
          const ruleObj = JSON.parse(m.rule) as Record<string, unknown>;
          ruleJson = JSON.stringify(replaceProviderIds(ruleObj, providerId));
        } else {
          ruleJson = JSON.stringify({
            targets: [{ backend_model: m.backend_model, provider_id: providerId }],
          });
        }
        if (existing) {
          updateMappingGroup(db, existing.id, {
            client_model: m.client_model,
            rule: ruleJson,
          });
        } else {
          createMappingGroup(db, {
            client_model: m.client_model,
            rule: ruleJson,
          });
        }
      }

      // 7. Create retry rules (bind to newly created provider if shortname matches)
      for (const r of body.retry_rules) {
        const ruleProviderId = r.provider_shortname ? providerId : null;
        createRetryRule(db, {
          name: r.name,
          status_code: r.status_code,
          body_pattern: r.body_pattern,
          is_active: 1,
          retry_strategy: r.retry_strategy,
          retry_delay_ms: r.retry_delay_ms,
          max_retries: r.max_retries,
          max_delay_ms: r.max_delay_ms,
          provider_id: ruleProviderId,
        });
      }

      // 8. Create transform rules
      if (body.transform_rules) {
        upsertTransformRule(db, providerId, {
          inject_headers: body.transform_rules.inject_headers ?? null,
          request_defaults: body.transform_rules.request_defaults ?? null,
          drop_fields: body.transform_rules.drop_fields ?? null,
          is_active: 1,
        });
      }

      return providerId;
    });

    // 8. Execute transaction
    const providerId = createAll();

    // 9. Sync concurrency state
    const finalAdaptiveEnabled = body.provider.concurrency_mode === 'auto' ? 1 : 0;
    const finalMaxConcurrency = body.provider.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency;
    const finalQueueTimeoutMs = body.provider.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms;
    const finalMaxQueueSize = body.provider.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size;

    adaptiveController?.syncProvider(providerId, {
      adaptive_enabled: finalAdaptiveEnabled,
      max_concurrency: finalMaxConcurrency,
      queue_timeout_ms: finalQueueTimeoutMs,
      max_queue_size: finalMaxQueueSize,
    });
    tracker?.updateProviderConfig(providerId, {
      name: body.provider.name,
      maxConcurrency: finalMaxConcurrency,
      queueTimeoutMs: finalQueueTimeoutMs,
      maxQueueSize: finalMaxQueueSize,
    });

    return reply.code(HTTP_CREATED).send({ success: true, provider_id: providerId });
  });

  app.get("/admin/api/quick-setup/init", async (_request, reply) => {
    // provider_groups (recommended providers with capabilities)
    const groups = getRecommendedProviders();
    for (const group of groups) {
      for (const preset of group.presets) {
        const capMap: Record<string, string[]> = {};
        for (const m of preset.models) {
          capMap[m] = lookupCapabilities(m);
        }
        preset.modelCapabilities = capMap;
      }
    }

    // recommended_rules (with exists flag)
    const rules = getRecommendedRetryRules();
    const existing = new Set<string>(
      (db.prepare("SELECT name FROM retry_rules").all() as { name: string }[]).map((r) => r.name),
    );
    const recommendedRules = rules.map(r => ({ ...r, exists: existing.has(r.name) }));

    // existing_mappings
    const existingMappings = getAllMappingGroups(db);

    // existing_providers
    const encryptionKey = getSetting(db, "encryption_key")!;
    const providers = getAllProviders(db);
    const serializedProviders = serializeProviders(db, providers, encryptionKey);

    return reply.send({
      provider_groups: groups,
      recommended_rules: recommendedRules,
      existing_mappings: existingMappings,
      existing_providers: serializedProviders,
    });
  });

  // ---------- Test Connection ----------

  const TestConnectionSchema = Type.Object({
    api_type: Type.Union([Type.Literal("openai"), Type.Literal("openai-responses"), Type.Literal("anthropic")]),
    base_url: Type.String({ minLength: 1 }),
    upstream_path: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    api_key: Type.String({ minLength: 1 }),
    model: Type.Optional(Type.String()),
  });

  app.post("/admin/api/test-connection", { schema: { body: TestConnectionSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof TestConnectionSchema>;
    const apiType = body.api_type;
    const baseUrl = body.base_url.replace(/\/+$/, "");
    const upstreamPath = body.upstream_path ?? null;
    const apiKey = body.api_key;

    // Determine model and path based on api_type
    let targetPath: string;
    let reqBody: Record<string, unknown>;
    let authHeader: string;

    if (apiType === "anthropic") {
      targetPath = upstreamPath ?? "/v1/messages";
      reqBody = {
        model: body.model ?? "claude-3-5-haiku-20241022",
        max_tokens: 32,
        messages: [{ role: "user", content: "Hi" }],
      };
      authHeader = `x-api-key`;
    } else {
      // openai or openai-responses
      targetPath = upstreamPath ?? "/v1/chat/completions";
      reqBody = {
        model: body.model ?? "gpt-4o-mini",
        max_tokens: 32,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hi in one word." },
        ],
      };
      authHeader = "authorization";
    }

    // Build full URL with dedup logic
    const fullUrl = buildTestUrl(baseUrl, targetPath);

    try {
      const result = await sendTestRequest(fullUrl, apiType, apiKey, authHeader, reqBody);
      return reply.send({ ok: true, model: body.model, latency_ms: result.latencyMs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      return reply.code(HTTP_BAD_GATEWAY).send({ ok: false, error: message });
    }
  });

  done();
};

// ---------- Test Connection Helpers ----------

const TEST_REQUEST_TIMEOUT_MS = 15_000;

const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

/** Build full URL, applying dedup logic for base_url already containing the path */
function buildTestUrl(baseUrl: string, upstreamPath: string): string {
  const KNOWN_SUFFIXES = ["/chat/completions", "/messages", "/responses"];
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith(upstreamPath)) return normalized;
  for (const suffix of KNOWN_SUFFIXES) {
    if (normalized.endsWith(suffix)) return normalized;
  }
  // Check for /v1 prefix overlap
  const versionMatch = upstreamPath.match(/^(\/v\d+)(.*)/);
  if (versionMatch) {
    const [, prefix, rest] = versionMatch;
    if (normalized.endsWith(prefix)) return `${normalized}${rest}`;
  }
  // Generic overlap detection
  const segments = upstreamPath.split("/");
  const MIN_OVERLAP_SEGMENTS = 2;
  for (let len = segments.length - 1; len >= MIN_OVERLAP_SEGMENTS; len--) {
    const candidate = segments.slice(0, len).join("/");
    if (candidate.length > 0 && normalized.endsWith(candidate)) {
      return `${normalized}${upstreamPath.slice(candidate.length)}`;
    }
  }
  if (!upstreamPath.startsWith("/")) return `${normalized}/${upstreamPath}`;
  return `${normalized}${upstreamPath}`;
}

interface TestResult {
  latencyMs: number;
}

/** Send a real test request to the upstream provider */
function sendTestRequest(
  fullUrl: string,
  apiType: string,
  apiKey: string,
  authHeaderKey: string,
  reqBody: Record<string, unknown>,
): Promise<TestResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const url = new URL(fullUrl);
    const payload = JSON.stringify(reqBody);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "accept": "application/json",
      "user-agent": "llm-simple-router/test-connection",
    };
    if (authHeaderKey === "x-api-key") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["content-type"] = "application/json";
    } else {
      headers["authorization"] = `Bearer ${apiKey}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT),
      path: url.pathname + url.search,
      method: "POST",
      headers: { ...headers, "content-length": `${Buffer.byteLength(payload)}` },
    };

    const mod = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = mod(options, (res: import("http").IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const statusCode = res.statusCode ?? 0;
        const body = Buffer.concat(chunks).toString("utf-8");
        const latencyMs = Date.now() - start;

        if (statusCode >= HTTP_SUCCESS_MIN && statusCode < HTTP_SUCCESS_MAX) {
          resolve({ latencyMs });
        } else {
          // Try to extract error message from response
          let errMsg = `HTTP ${statusCode}`;
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const error = parsed.error as Record<string, unknown> | undefined;
            if (error?.message) {
              errMsg = typeof error.message === "string" ? error.message : JSON.stringify(error.message);
            } else if (parsed.message) {
              errMsg = typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed.message);
            }
          } catch {
            // response body is not valid JSON, keep default HTTP error
            void 0;
          }
          reject(new Error(errMsg));
        }
      });
      res.on("error", (err: Error) => reject(err));
    });

    req.setTimeout(TEST_REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Connection timed out"));
    });
    req.on("error", (err: Error) => reject(err));
    req.write(payload);
    req.end();
  });
}
