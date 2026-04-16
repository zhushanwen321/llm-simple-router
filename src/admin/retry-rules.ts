import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import type { RetryRule } from "../db/index.js";
import {
  getAllRetryRules,
  createRetryRule,
  updateRetryRule,
  deleteRetryRule,
} from "../db/index.js";
import { RetryRuleMatcher } from "../proxy/retry-rules.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED } from "./constants.js";

const CreateRetryRuleSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  status_code: Type.Number({ minimum: 100, maximum: 599 }),
  body_pattern: Type.String({ minLength: 1 }),
  is_active: Type.Optional(Type.Number()),
});

const UpdateRetryRuleSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  status_code: Type.Optional(Type.Number({ minimum: 100, maximum: 599 })),
  body_pattern: Type.Optional(Type.String({ minLength: 1 })),
  is_active: Type.Optional(Type.Number()),
});

interface RetryRuleRoutesOptions {
  db: Database.Database;
  matcher: RetryRuleMatcher | null;
}

function validateBodyPattern(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
    return undefined;
  } catch {
    return "Invalid body_pattern regex";
  }
}

function refreshMatcher(matcher: RetryRuleMatcher | null, db: Database.Database) {
  if (matcher) matcher.load(db);
}

export const adminRetryRuleRoutes: FastifyPluginCallback<RetryRuleRoutesOptions> = (app, options, done) => {
  const { db, matcher } = options;

  app.get("/admin/api/retry-rules", async (_request, reply) => {
    const rules = getAllRetryRules(db);
    return reply.send(rules);
  });

  app.post("/admin/api/retry-rules", { schema: { body: CreateRetryRuleSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateRetryRuleSchema>;
    const regexError = validateBodyPattern(body.body_pattern);
    if (regexError) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: regexError } });
    }
    const id = createRetryRule(db, {
      name: body.name,
      status_code: body.status_code,
      body_pattern: body.body_pattern,
      is_active: body.is_active ?? 1,
    });
    refreshMatcher(matcher, db);
    return reply.code(HTTP_CREATED).send({ id });
  });

  app.put("/admin/api/retry-rules/:id", { schema: { body: UpdateRetryRuleSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Static<typeof UpdateRetryRuleSchema>;
    const fields: Partial<Pick<RetryRule, "name" | "status_code" | "body_pattern" | "is_active">> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.status_code !== undefined) fields.status_code = body.status_code;
    if (body.body_pattern !== undefined) {
      const regexError = validateBodyPattern(body.body_pattern);
      if (regexError) {
        return reply.code(HTTP_BAD_REQUEST).send({ error: { message: regexError } });
      }
      fields.body_pattern = body.body_pattern;
    }
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    updateRetryRule(db, id, fields);
    refreshMatcher(matcher, db);
    return reply.send({ success: true });
  });

  app.delete("/admin/api/retry-rules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteRetryRule(db, id);
    refreshMatcher(matcher, db);
    return reply.send({ success: true });
  });

  done();
};
