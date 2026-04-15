import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import type { ModelMapping } from "../db/index.js";
import { getAllModelMappings, createModelMapping, updateModelMapping, deleteModelMapping, getProviderById } from "../db/index.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;

interface CreateMappingBody {
  client_model: string;
  backend_model: string;
  provider_id: string;
  is_active?: number;
}

interface UpdateMappingBody {
  client_model?: string;
  backend_model?: string;
  provider_id?: string;
  is_active?: number;
}

interface MappingRoutesOptions {
  db: Database.Database;
}

export const adminMappingRoutes: FastifyPluginCallback<MappingRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/mappings", async (_request, reply) => {
    const mappings = getAllModelMappings(db);
    return reply.send(mappings);
  });

  app.post("/admin/api/mappings", async (request, reply) => {
    const body = request.body as CreateMappingBody;
    if (!body.client_model || !body.backend_model || !body.provider_id) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "Missing required fields: client_model, backend_model, provider_id" } });
    }
    const provider = getProviderById(db, body.provider_id);
    if (!provider) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "provider_id not found" } });
    }
    try {
      const id = createModelMapping(db, {
        client_model: body.client_model,
        backend_model: body.backend_model,
        provider_id: body.provider_id,
        is_active: body.is_active ?? 1,
      });
      return reply.code(HTTP_CREATED).send({ id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send({ error: { message: "client_model already exists" } });
      }
      throw err;
    }
  });

  app.put("/admin/api/mappings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as UpdateMappingBody;
    const fields: Partial<Pick<ModelMapping, 'client_model' | 'backend_model' | 'provider_id' | 'is_active'>> = {};
    if (body.client_model !== undefined) fields.client_model = body.client_model;
    if (body.backend_model !== undefined) fields.backend_model = body.backend_model;
    if (body.provider_id !== undefined) fields.provider_id = body.provider_id;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    try {
      updateModelMapping(db, id, fields);
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
    deleteModelMapping(db, id);
    return reply.send({ success: true });
  });

  done();
};
