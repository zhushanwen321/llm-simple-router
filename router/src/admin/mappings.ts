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
  getMappingGroup,
} from "../db/index.js";
import type { MappingGroup } from "../db/index.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

const CreateMappingSchema = Type.Object({
  client_model: Type.String({ minLength: 1 }),
  backend_model: Type.String({ minLength: 1 }),
  provider_id: Type.String({ minLength: 1 }),
});

const UpdateMappingSchema = Type.Object({
  client_model: Type.Optional(Type.String({ minLength: 1 })),
  backend_model: Type.Optional(Type.String({ minLength: 1 })),
  provider_id: Type.Optional(Type.String({ minLength: 1 })),
});

interface MappingRoutesOptions {
  db: Database.Database;
}

interface LegacyMapping {
  id: string;
  client_model: string;
  backend_model: string;
  provider_id: string;
  is_active: number;
  created_at: string;
}

function toLegacy(group: { id: string; client_model: string; rule: string; created_at: string }): LegacyMapping | null {
  let rule: unknown;
  try {
    rule = JSON.parse(group.rule);
  } catch {
    return null;
  }
  const targets = (rule as Record<string, unknown>)?.targets as Record<string, string>[] | undefined;
  if (!targets || targets.length === 0) return null;
  return {
    id: group.id,
    client_model: group.client_model,
    backend_model: targets[0].backend_model ?? "",
    provider_id: targets[0].provider_id ?? "",
    is_active: 1,
    created_at: group.created_at,
  };
}

function findGroupByIdOrClientModel(
  db: Database.Database,
  id: string
): MappingGroup | undefined {
  return getMappingGroupById(db, id) ?? getMappingGroup(db, id);
}

export const adminMappingRoutes: FastifyPluginCallback<MappingRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/mappings", async (_request, reply) => {
    const groups = getAllMappingGroups(db);
    const legacy = groups.map(toLegacy).filter((m): m is LegacyMapping => m !== null);
    return reply.send(legacy);
  });

  app.post("/admin/api/mappings", { schema: { body: CreateMappingSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateMappingSchema>;
    const provider = getProviderById(db, body.provider_id);
    if (!provider) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.NOT_FOUND, "provider_id not found"));
    }
    try {
      const id = createMappingGroup(db, {
        client_model: body.client_model,
        rule: JSON.stringify({
          targets: [{ backend_model: body.backend_model, provider_id: body.provider_id }],
        }),
      });
      return reply.code(HTTP_CREATED).send({ id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_NAME, "client_model already exists"));
      }
      throw err;
    }
  });

  app.put("/admin/api/mappings/:id", { schema: { body: UpdateMappingSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const group = findGroupByIdOrClientModel(db, id);
    if (!group) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Mapping not found"));
    }
    const body = request.body as Static<typeof UpdateMappingSchema>;

    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(group.rule);
    } catch {
      rule = { targets: [{}] };
    }
    const targets = (rule.targets as Record<string, string>[]) || [];
    const firstTarget = { ...(targets[0] || {}) };
    if (body.backend_model !== undefined) firstTarget.backend_model = body.backend_model;
    if (body.provider_id !== undefined) {
      const provider = getProviderById(db, body.provider_id);
      if (!provider) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.NOT_FOUND, "provider_id not found"));
      }
      firstTarget.provider_id = body.provider_id;
    }
    if (targets.length > 0) {
      targets[0] = firstTarget;
    } else {
      targets.push(firstTarget);
    }
    rule.targets = targets;

    const fields: { client_model?: string; rule: string } = {
      rule: JSON.stringify(rule),
    };
    if (body.client_model !== undefined) fields.client_model = body.client_model;

    try {
      updateMappingGroup(db, group.id, fields);
      return reply.send({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.CONFLICT_NAME, "client_model already exists"));
      }
      throw err;
    }
  });

  app.delete("/admin/api/mappings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const group = findGroupByIdOrClientModel(db, id);
    if (!group) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Mapping not found"));
    }
    deleteMappingGroup(db, group.id);
    return reply.send({ success: true });
  });

  done();
};
