import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import {
  getAllMappingGroups,
  createMappingGroup,
  updateMappingGroup,
  deleteMappingGroup,
  getProviderById,
  getMappingGroupById,
  getAllProviders,
} from "../db/index.js";
import { getSetting } from "../db/settings.js";
import { serializeProviders } from "./providers.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_CONFLICT, HTTP_NOT_FOUND } from "../core/constants.js";
import { parseModels } from "../config/model-context.js";
import { validateCircuitBreaker } from "./utils.js";
import { API_CODE, apiError } from "./api-response.js";

const CreateGroupSchema = Type.Object({
  client_model: Type.String({ minLength: 1 }),
  rule: Type.String(),
});

const UpdateGroupSchema = Type.Object({
  client_model: Type.Optional(Type.String({ minLength: 1 })),
  rule: Type.Optional(Type.String()),
});

interface GroupRoutesOptions {
  db: Database.Database;
}

interface TargetInput {
  backend_model?: string;
  provider_id?: string;
  overflow_provider_id?: string;
  overflow_model?: string;
}

function validateOverflow(db: Database.Database, target: TargetInput, label: string): string | undefined {
  const hasOverflowProvider = !!target.overflow_provider_id;
  const hasOverflowModel = !!target.overflow_model;
  if (hasOverflowProvider && !hasOverflowModel) {
    return `${label}: overflow_provider_id requires overflow_model`;
  }
  if (hasOverflowModel && !hasOverflowProvider) {
    return `${label}: overflow_model requires overflow_provider_id`;
  }
  if (hasOverflowProvider) {
    const p = getProviderById(db, target.overflow_provider_id!);
    if (!p) {
      return `${label}: overflow_provider_id '${target.overflow_provider_id}' not found`;
    }
  }
  return undefined;
}

function validateRule(
  db: Database.Database,
  ruleJson: string,
): string | undefined {
  let rule: unknown;
  try {
    rule = JSON.parse(ruleJson);
  } catch {
    return "Invalid rule JSON";
  }

  if (typeof rule !== "object" || rule === null) return "Invalid rule";
  const r = rule as { targets?: unknown[] };

  if (!Array.isArray(r.targets) || r.targets.length === 0) {
    return "rule.targets must be a non-empty array";
  }

  for (let i = 0; i < r.targets.length; i++) {
    const t = r.targets[i] as TargetInput;
    if (!t.backend_model || !t.provider_id) {
      return `targets[${i}] missing backend_model or provider_id`;
    }
    const p = getProviderById(db, t.provider_id);
    if (!p) {
      return `targets[${i}] provider_id '${t.provider_id}' not found`;
    }
    const overflowErr = validateOverflow(db, t, `targets[${i}]`);
    if (overflowErr) return overflowErr;
  }

  const cbErr = validateCircuitBreaker(
    r.targets as ReadonlyArray<{ circuit_breaker?: unknown }>,
  );
  if (cbErr) return cbErr;

  // Validate multimodal_fallback if present
  const fallback = (r as Record<string, unknown>).multimodal_fallback;
  if (fallback !== undefined && fallback !== null) {
    const fb = fallback as { provider_id?: string; backend_model?: string };
    if (!fb.provider_id) {
      return "multimodal_fallback: provider_id is required";
    }
    if (!fb.backend_model) {
      return "multimodal_fallback: backend_model is required";
    }
    const fbProvider = getProviderById(db, fb.provider_id);
    if (!fbProvider) {
      return `multimodal_fallback: provider_id '${fb.provider_id}' not found`;
    }
    if (fbProvider.is_active !== 1) {
      return `multimodal_fallback: provider '${fbProvider.name}' is not active`;
    }
    // 校验 backend_model 是否在 provider 的 models 列表中
    const providerModels = parseModels(fbProvider.models);
    const modelExists = providerModels.some(m => m.name === fb.backend_model);
    if (!modelExists) {
      return `multimodal_fallback: backend_model '${fb.backend_model}' not found in provider '${fbProvider.name}' models list`;
    }
  }

  return undefined;
}

export const adminGroupRoutes: FastifyPluginCallback<GroupRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/mapping-groups", async (_request, reply) => {
    const groups = getAllMappingGroups(db);
    return reply.send(groups);
  });

  app.get("/admin/api/mapping-groups/init", async (_request, reply) => {
    const groups = getAllMappingGroups(db);
    const encryptionKey = getSetting(db, "encryption_key")!;
    const providers = getAllProviders(db);
    const serialized = serializeProviders(db, providers, encryptionKey);
    return reply.send({ groups, providers: serialized });
  });

  app.post("/admin/api/mapping-groups", { schema: { body: CreateGroupSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateGroupSchema>;
    const validationError = validateRule(db, body.rule);
    if (validationError) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, validationError));
    }
    try {
      const id = createMappingGroup(db, {
        client_model: body.client_model,
        rule: body.rule,
      });
      return reply.code(HTTP_CREATED).send({ id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_NAME, "client_model already exists"));
      }
      throw err;
    }
  });

  app.put("/admin/api/mapping-groups/:id", { schema: { body: UpdateGroupSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Static<typeof UpdateGroupSchema>;
    const fields: Partial<Pick<import("../db/index.js").MappingGroup, "client_model" | "rule">> = {};
    if (body.client_model !== undefined) fields.client_model = body.client_model;
    if (body.rule !== undefined) fields.rule = body.rule;

    const ruleJson = body.rule ?? findGroupRule(db, id);
    const validationError = validateRule(db, ruleJson);
    if (validationError) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, validationError));
    }

    try {
      updateMappingGroup(db, id, fields);
      return reply.send({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_NAME, "client_model already exists"));
      }
      throw err;
    }
  });

  app.delete("/admin/api/mapping-groups/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getMappingGroupById(db, id);
    if (!existing) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Mapping group not found"));
    deleteMappingGroup(db, id);
    return reply.send({ success: true });
  });

  app.post("/admin/api/mapping-groups/:id/toggle", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getMappingGroupById(db, id);
    if (!existing) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Mapping group not found"));
    const newActive = existing.is_active ? 0 : 1;
    updateMappingGroup(db, id, { is_active: newActive });
    return reply.send({ success: true, is_active: newActive });
  });

  done();
};

function findGroupRule(db: Database.Database, id: string): string {
  const g = getMappingGroupById(db, id);
  return g?.rule ?? "{}";
}
