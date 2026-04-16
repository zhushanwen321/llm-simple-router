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
import { STRATEGY_NAMES } from "../proxy/strategy/types.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT } from "./constants.js";

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
  const defaultTarget = (rule as Record<string, unknown>)?.default as Record<string, string> | undefined;
  if (!defaultTarget) return null;
  return {
    id: group.id,
    client_model: group.client_model,
    backend_model: defaultTarget.backend_model ?? "",
    provider_id: defaultTarget.provider_id ?? "",
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
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "provider_id not found" } });
    }
    try {
      const id = createMappingGroup(db, {
        client_model: body.client_model,
        strategy: STRATEGY_NAMES.SCHEDULED,
        rule: JSON.stringify({
          default: { backend_model: body.backend_model, provider_id: body.provider_id },
          windows: [],
        }),
      });
      return reply.code(HTTP_CREATED).send({ id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send({ error: { message: "client_model already exists" } });
      }
      throw err;
    }
  });

  app.put("/admin/api/mappings/:id", { schema: { body: UpdateMappingSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const group = findGroupByIdOrClientModel(db, id);
    if (!group) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Mapping not found" } });
    }
    const body = request.body as Static<typeof UpdateMappingSchema>;

    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(group.rule);
    } catch {
      rule = { default: {}, windows: [] };
    }
    const defaultTarget = { ...(rule.default as Record<string, string> || {}) };
    if (body.backend_model !== undefined) defaultTarget.backend_model = body.backend_model;
    if (body.provider_id !== undefined) {
      const provider = getProviderById(db, body.provider_id);
      if (!provider) {
        return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "provider_id not found" } });
      }
      defaultTarget.provider_id = body.provider_id;
    }
    rule.default = defaultTarget;

    const fields: { client_model?: string; rule: string } = {
      rule: JSON.stringify(rule),
    };
    if (body.client_model !== undefined) fields.client_model = body.client_model;

    try {
      updateMappingGroup(db, group.id, fields);
      return reply.send({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send({ error: { message: "client_model already exists" } });
      }
      throw err;
    }
  });

  app.delete("/admin/api/mappings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const group = findGroupByIdOrClientModel(db, id);
    if (!group) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Mapping not found" } });
    }
    deleteMappingGroup(db, group.id);
    return reply.send({ success: true });
  });

  done();
};
