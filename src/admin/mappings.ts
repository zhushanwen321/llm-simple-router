import { FastifyPluginCallback } from "fastify";
import { getAllModelMappings, createModelMapping, updateModelMapping, deleteModelMapping, getProviderById } from "../db/index.js";

interface MappingRoutesOptions {
  db: any;
}

export const adminMappingRoutes: FastifyPluginCallback<MappingRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/mappings", async (_request, reply) => {
    const mappings = getAllModelMappings(db);
    return reply.send(mappings);
  });

  app.post("/admin/api/mappings", async (request, reply) => {
    const body = request.body as any;
    if (!body.client_model || !body.backend_model || !body.provider_id) {
      return reply.code(400).send({ error: { message: "Missing required fields: client_model, backend_model, provider_id" } });
    }
    const provider = getProviderById(db, body.provider_id);
    if (!provider) {
      return reply.code(400).send({ error: { message: "provider_id not found" } });
    }
    try {
      const id = createModelMapping(db, {
        client_model: body.client_model,
        backend_model: body.backend_model,
        provider_id: body.provider_id,
        is_active: body.is_active ?? 1,
      });
      return reply.code(201).send({ id });
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint")) {
        return reply.code(409).send({ error: { message: "client_model already exists" } });
      }
      throw err;
    }
  });

  app.put("/admin/api/mappings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const fields: any = {};
    if (body.client_model !== undefined) fields.client_model = body.client_model;
    if (body.backend_model !== undefined) fields.backend_model = body.backend_model;
    if (body.provider_id !== undefined) fields.provider_id = body.provider_id;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    try {
      updateModelMapping(db, id, fields);
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint")) {
        return reply.code(409).send({ error: { message: "client_model already exists" } });
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
