import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

// 加载 AI 重试规则的 system prompt 模板（独立文件，避免模板字面量转义问题）
const AI_RETRY_PROMPT_TEMPLATE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ai-retry-prompt.md"),
  "utf-8",
);

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
  if (raw.length <= MAX_RESPONSE_CHARS) return raw;
  const TRUNCATION_SUFFIX = "\n...(truncated)";
  const truncated = raw.substring(0, MAX_RESPONSE_CHARS - TRUNCATION_SUFFIX.length);
  // 在 JSON 边界处截断，避免破坏键值对导致 AI 生成无效正则
  const lastBrace = truncated.lastIndexOf("}");
  const lastBracket = truncated.lastIndexOf("]");
  const cutPoint = Math.max(lastBrace, lastBracket);
  const MIN_RATIO_FOR_BOUNDARY_CUT = 0.5;
  return cutPoint > truncated.length * MIN_RATIO_FOR_BOUNDARY_CUT ? truncated.substring(0, cutPoint + 1) + TRUNCATION_SUFFIX : truncated + TRUNCATION_SUFFIX;
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

/** 从 AI 返回的 error 字段提取可读错误信息（兼容 string 和 object 两种格式） */
function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const obj = error as Record<string, unknown>;
  const msg = obj.message;
  return typeof msg === "string" ? msg : JSON.stringify(error);
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
  // ReDoS 防护：限制正则长度 + 检测已知危险模式
  const MAX_PATTERN_LENGTH = 500;
  if (parsed.body_pattern.length > MAX_PATTERN_LENGTH) {
    return `Rule validation failed: body_pattern too long (max ${MAX_PATTERN_LENGTH} chars)`;
  }
  const DANGEROUS_REGEX_PATTERNS = [
    /\([^)]*\+[^)]*\+/,          // 嵌套量词如 (a+b+)+
    /\([^)]*[*+][^)]*\)\s*[*+]/,  // 重复分组 + 量词
    /\(\.\*[^)]*\)\s*[*+]/,     // (.*)+ 类型
  ];
  for (const dangerous of DANGEROUS_REGEX_PATTERNS) {
    if (dangerous.test(parsed.body_pattern)) {
      return "Rule validation failed: body_pattern contains potentially catastrophic regex";
    }
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

const MAX_PROMPT_RULES = 20;

/** 构造 system prompt，基于外部模板文件 + 现有规则列表 */
function buildSystemPrompt(existingRules: RetryRule[]): string {
  const displayRules = existingRules.slice(0, MAX_PROMPT_RULES);
  const rulesList = displayRules.length > 0
    ? displayRules.map((r) => `- ${r.name}: status=${r.status_code}, pattern=${r.body_pattern}`).join("\n")
    : "(none)";
  const truncateHint = existingRules.length > MAX_PROMPT_RULES ? `\n... and ${existingRules.length - MAX_PROMPT_RULES} more rules` : "";

  return `${AI_RETRY_PROMPT_TEMPLATE}\n\n${rulesList}${truncateHint}\n\nNote: The Response Body may be truncated. Generate body_pattern based only on the complete key-value pairs you can see.`;
}

/** 构造 user prompt，使用 provider_name 而非 provider_id */
function buildUserPrompt(
  log: { provider_id: string | null; provider_name: string | null; model: string | null; status_code: number | null; error_message: string | null },
  responseText: string,
): string {
  const providerDisplayName = log.provider_name || log.provider_id || "unknown";
  return `Provider: ${providerDisplayName}
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

  const AiGenerateBodySchema = Type.Object({
    log_id: Type.String({ minLength: 1 }),
  });

  // AI generate retry rule endpoint
  app.post("/admin/api/retry-rules/ai-generate", { schema: { body: AiGenerateBodySchema } }, async (request, reply) => {
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
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (!(e instanceof Error)) {
        request.log.error({ err: e }, "LLM call failed with non-Error");
      }
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
    if (parsed.error != null) {
      const errorMsg = typeof parsed.error === "string"
        ? parsed.error
        : extractErrorMessage(parsed.error);
      return reply.send({ success: false, error: errorMsg });
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
