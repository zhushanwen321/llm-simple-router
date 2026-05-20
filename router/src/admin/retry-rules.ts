import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import type { RetryRule } from "../db/index.js";
import {
  getAllRetryRules,
  getRetryRuleById,
  createRetryRule,
  updateRetryRule,
  deleteRetryRule,
} from "../db/index.js";
import { callLLM } from "../utils/llm-client.js";
import { getActiveRetryRules } from "../db/retry-rules.js";
import { getRequestLogById } from "../db/logs.js";
import { getProviderById } from "../db/providers.js";
import { getSetting } from "../db/settings.js";
import { decrypt } from "../utils/crypto.js";
import type { StateRegistry } from "../core/registry.js";
import { HTTP_OK, HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_MAX_DELAY_MS = 60000;

const CreateRetryRuleSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  status_code: Type.Number({ minimum: 100, maximum: 599 }),
  body_pattern: Type.String({ minLength: 1 }),
  is_active: Type.Optional(Type.Number()),
  retry_strategy: Type.Optional(Type.Union([Type.Literal("fixed"), Type.Literal("exponential")])),
  retry_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
  max_retries: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  max_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
});

const UpdateRetryRuleSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  status_code: Type.Optional(Type.Number({ minimum: 100, maximum: 599 })),
  body_pattern: Type.Optional(Type.String({ minLength: 1 })),
  is_active: Type.Optional(Type.Number()),
  retry_strategy: Type.Optional(Type.Union([Type.Literal("fixed"), Type.Literal("exponential")])),
  retry_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
  max_retries: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  max_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
});

interface RetryRuleRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
}

function validateBodyPattern(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
    return undefined;
  } catch {
    return "Invalid body_pattern regex";
  }
}

// ---------- AI Retry Rule Generation Helpers ----------

const MAX_RESPONSE_CHARS = 4000;
const STATUS_CODE_MIN = 100;
const STATUS_CODE_MAX = 599;
const MAX_RETRIES_UPPER = 100;

/** 从日志中提取响应文本，优先 upstream_response，回退 stream_text_content */
function extractResponseText(log: { upstream_response: string | null; stream_text_content: string | null }): string {
  const raw = log.upstream_response || log.stream_text_content || "";
  return raw.length > MAX_RESPONSE_CHARS ? raw.substring(0, MAX_RESPONSE_CHARS) : raw;
}

/** 检查文本是否包含错误特征关键词（case-insensitive） */
function hasErrorFeatures(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes("error");
}

/** 解析 AI 返回的 JSON，支持 ```json 代码块包裹 */
function parseAIContent(content: string): Record<string, unknown> | null {
  const codeBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : content.trim();
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 校验 AI 生成的规则字段，返回错误描述或 null */
function validateAIRule(parsed: Record<string, unknown>): string | null {
  if (typeof parsed.summary !== "string" || parsed.summary.trim() === "") {
    return "summary is required";
  }
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    return "name is required";
  }
  if (typeof parsed.status_code !== "number" || !Number.isInteger(parsed.status_code) || parsed.status_code < STATUS_CODE_MIN || parsed.status_code > STATUS_CODE_MAX) {
    return "status_code must be 100-599";
  }
  if (typeof parsed.body_pattern !== "string") {
    return "body_pattern is required";
  }
  try {
    new RegExp(parsed.body_pattern);
  } catch {
    return "body_pattern is not a valid regex";
  }
  if (parsed.retry_strategy !== "fixed" && parsed.retry_strategy !== "exponential") {
    return "retry_strategy must be 'fixed' or 'exponential'";
  }
  if (typeof parsed.retry_delay_ms !== "number" || !Number.isInteger(parsed.retry_delay_ms) || parsed.retry_delay_ms <= 0) {
    return "retry_delay_ms must be a positive integer";
  }
  if (typeof parsed.max_retries !== "number" || !Number.isInteger(parsed.max_retries) || parsed.max_retries < 0 || parsed.max_retries > MAX_RETRIES_UPPER) {
    return "max_retries must be 0-100";
  }
  if (typeof parsed.max_delay_ms !== "number" || !Number.isInteger(parsed.max_delay_ms) || parsed.max_delay_ms <= 0) {
    return "max_delay_ms must be a positive integer";
  }
  return null;
}

/** 构造 system prompt，包含现有规则列表 */
function buildSystemPrompt(existingRules: RetryRule[]): string {
  const rulesList = existingRules.length > 0
    ? existingRules.map((r) => `- ${r.name}: status=${r.status_code}, pattern=${r.body_pattern}`).join("\n")
    : "(none)";

  return `You are an API retry rule expert. Analyze the HTTP error response and generate a retry rule.

## Guidelines
- Identify unique error identifiers in the response (error code, type, message)
- Construct a specific regex body_pattern using | to combine identifiers
- 429: fixed strategy, 5000-30000ms delay, 3-5 max_retries
- 500/502/503: exponential strategy, 1000-3000ms delay, 3-5 max_retries
- Name: "{Provider} {StatusCode} {ErrorType} Retry"

## Existing rules (avoid duplicates)
${rulesList}

## If the response is normal (no error), return:
{"error":"Unable to generate rule: normal response"}

## Otherwise return ONLY valid JSON:
{"summary":"...","name":"...","status_code":...,"body_pattern":"...","retry_strategy":"fixed|exponential","retry_delay_ms":...,"max_retries":...,"max_delay_ms":...}`;
}

/** 构造 user prompt */
function buildUserPrompt(
  log: { provider_id: string | null; model: string | null; status_code: number | null; error_message: string | null },
  responseText: string,
): string {
  return `Provider: ${log.provider_id ?? "unknown"}
Model: ${log.model ?? "unknown"}
Status Code: ${log.status_code ?? "N/A"}
Error Message: ${log.error_message ?? "N/A"}

Response Body:
${responseText}`;
}

export const adminRetryRuleRoutes: FastifyPluginCallback<RetryRuleRoutesOptions> = (app, options, done) => {
  const { db, stateRegistry } = options;

  app.get("/admin/api/retry-rules", async (_request, reply) => {
    const rules = getAllRetryRules(db);
    return reply.send(rules);
  });

  app.post("/admin/api/retry-rules", { schema: { body: CreateRetryRuleSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateRetryRuleSchema>;
    const regexError = validateBodyPattern(body.body_pattern);
    if (regexError) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.INVALID_REGEX, regexError));
    }
    const id = createRetryRule(db, {
      name: body.name,
      status_code: body.status_code,
      body_pattern: body.body_pattern,
      is_active: body.is_active ?? 1,
      retry_strategy: body.retry_strategy ?? "exponential",
      retry_delay_ms: body.retry_delay_ms ?? DEFAULT_RETRY_DELAY_MS,
      max_retries: body.max_retries ?? DEFAULT_MAX_RETRIES,
      max_delay_ms: body.max_delay_ms ?? DEFAULT_MAX_DELAY_MS,
    });
    stateRegistry?.refreshRetryRules();
    return reply.code(HTTP_CREATED).send({ id });
  });

  app.put("/admin/api/retry-rules/:id", { schema: { body: UpdateRetryRuleSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Static<typeof UpdateRetryRuleSchema>;
    const fields: Partial<Pick<RetryRule, "name" | "status_code" | "body_pattern" | "is_active" | "retry_strategy" | "retry_delay_ms" | "max_retries" | "max_delay_ms">> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.status_code !== undefined) fields.status_code = body.status_code;
    if (body.body_pattern !== undefined) {
      const regexError = validateBodyPattern(body.body_pattern);
      if (regexError) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.INVALID_REGEX, regexError));
      }
      fields.body_pattern = body.body_pattern;
    }
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    if (body.retry_strategy !== undefined) fields.retry_strategy = body.retry_strategy;
    if (body.retry_delay_ms !== undefined) fields.retry_delay_ms = body.retry_delay_ms;
    if (body.max_retries !== undefined) fields.max_retries = body.max_retries;
    if (body.max_delay_ms !== undefined) fields.max_delay_ms = body.max_delay_ms;
    updateRetryRule(db, id, fields);
    stateRegistry?.refreshRetryRules();
    return reply.send({ success: true });
  });

  app.delete("/admin/api/retry-rules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getRetryRuleById(db, id);
    if (!existing) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Retry rule not found"));
    deleteRetryRule(db, id);
    stateRegistry?.refreshRetryRules();
    return reply.send({ success: true });
  });

  // AI generate retry rule endpoint
  app.post("/admin/api/retry-rules/ai-generate", async (request, reply) => {
    const { log_id } = request.body as { log_id: string };

    // All responses let onSend hook wrap in { code, message, data } envelope
    // Frontend request<T>() auto-unwraps body.data

    // 1. Check AI config
    const aiConfigRaw = getSetting(db, "ai_retry_config");
    if (!aiConfigRaw) {
      return reply.send({ success: false, error: "AI retry config not set" });
    }
    let aiConfig: { provider_id: string; model: string };
    try {
      aiConfig = JSON.parse(aiConfigRaw) as { provider_id: string; model: string };
    } catch {
      return reply.send({ success: false, error: "AI config is invalid JSON" });
    }
    if (!aiConfig.provider_id || !aiConfig.model) {
      return reply.send({ success: false, error: "AI config is incomplete" });
    }

    // 2. Look up the log
    const log = getRequestLogById(db, log_id);
    if (!log) {
      return reply.send({ success: false, error: "Log not found" });
    }

    // 3. Extract response text
    const responseText = extractResponseText(log);

    // 4. Pre-check: reject 2xx responses without error features
    const HTTP_MULTIPLE_CHOICES = 300;
    const is2xx = log.status_code !== null && log.status_code >= HTTP_OK && log.status_code < HTTP_MULTIPLE_CHOICES;
    if (is2xx && !log.error_message && !hasErrorFeatures(responseText)) {
      return reply.send({ success: false, error: "Cannot generate retry rule for a successful response" });
    }

    // 5. Get the configured AI provider
    const provider = getProviderById(db, aiConfig.provider_id);
    if (!provider) {
      return reply.send({ success: false, error: "AI provider not found" });
    }

    // 6. Decrypt API key
    const encryptionKey = getSetting(db, "encryption_key");
    if (!encryptionKey) {
      return reply.send({ success: false, error: "Encryption key not set" });
    }
    let apiKey: string;
    try {
      apiKey = decrypt(provider.api_key, encryptionKey);
    } catch {
      return reply.send({ success: false, error: "Failed to decrypt API key" });
    }

    // 7. Build prompts
    const existingRules = getActiveRetryRules(db);
    const systemPrompt = buildSystemPrompt(existingRules);
    const userPrompt = buildUserPrompt(log, responseText);

    // 8. Call LLM
    let llmResult: { content: string };
    try {
      llmResult = await callLLM({
        baseUrl: provider.base_url,
        upstreamPath: provider.upstream_path,
        apiKey,
        model: aiConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        maxTokens: 2048,
        timeoutMs: 30_000,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      return reply.send({ success: false, error: `LLM call failed: ${msg}` });
    }

    // 9. Parse AI response
    const parsed = parseAIContent(llmResult.content);
    if (!parsed) {
      // Check if the raw content is an error/refusal message
      const lowerContent = llmResult.content.toLowerCase().trim();
      if (lowerContent.startsWith("error") || lowerContent.includes("unable to")) {
        return reply.send({ success: false, error: "AI returned an error exit" });
      }
      return reply.send({ success: false, error: "Failed to parse AI response as JSON" });
    }

    // 10. AI exit check — parsed object has an error field
    if (typeof parsed.error === "string") {
      return reply.send({ success: false, error: parsed.error });
    }

    // 11. Validate fields
    const validationError = validateAIRule(parsed);
    if (validationError) {
      return reply.send({ success: false, error: `Rule validation failed: ${validationError}` });
    }

    // 12. Return success
    return reply.send({
      success: true,
      rule: {
        name: parsed.name,
        status_code: parsed.status_code,
        body_pattern: parsed.body_pattern,
        retry_strategy: parsed.retry_strategy,
        retry_delay_ms: parsed.retry_delay_ms,
        max_retries: parsed.max_retries,
        max_delay_ms: parsed.max_delay_ms,
      },
      summary: parsed.summary,
    });
  });

  done();
};
