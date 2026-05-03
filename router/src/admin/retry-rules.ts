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
import type { StateRegistry } from "../core/registry.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND } from "./constants.js";
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

  done();
};
