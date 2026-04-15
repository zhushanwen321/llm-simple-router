import { FastifyPluginCallback } from "fastify";
import { getAllBackendServices, getBackendServiceById, createBackendService, updateBackendService, deleteBackendService } from "../db/index.js";
import { decrypt, encrypt } from "../utils/crypto.js";

interface ServiceRoutesOptions {
  db: any;
  encryptionKey: string;
}

function maskApiKey(encrypted: string, key: string): string {
  const decrypted = decrypt(encrypted, key);
  if (decrypted.length <= 8) return "****";
  return `${decrypted.slice(0, 4)}...${decrypted.slice(-4)}`;
}

export const adminServiceRoutes: FastifyPluginCallback<ServiceRoutesOptions> = (app, options, done) => {
  const { db, encryptionKey } = options;

  app.get("/admin/api/services", async (_request, reply) => {
    const services = getAllBackendServices(db);
    return reply.send(services.map((s) => ({
      ...s,
      api_key: maskApiKey(s.api_key, encryptionKey),
    })));
  });

  app.post("/admin/api/services", async (request, reply) => {
    const body = request.body as any;
    if (!body.name || !body.api_type || !body.base_url || !body.api_key) {
      return reply.code(400).send({ error: { message: "Missing required fields: name, api_type, base_url, api_key" } });
    }
    if (!["openai", "anthropic"].includes(body.api_type)) {
      return reply.code(400).send({ error: { message: "api_type must be 'openai' or 'anthropic'" } });
    }
    const encryptedKey = encrypt(body.api_key, encryptionKey);
    const id = createBackendService(db, {
      name: body.name,
      api_type: body.api_type,
      base_url: body.base_url,
      api_key: encryptedKey,
      is_active: body.is_active ?? 1,
    });
    return reply.code(201).send({ id });
  });

  app.put("/admin/api/services/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getBackendServiceById(db, id);
    if (!existing) {
      return reply.code(404).send({ error: { message: "Service not found" } });
    }
    const body = request.body as any;
    const fields: any = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.api_type !== undefined) fields.api_type = body.api_type;
    if (body.base_url !== undefined) fields.base_url = body.base_url;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    if (body.api_key) fields.api_key = encrypt(body.api_key, encryptionKey);
    updateBackendService(db, id, fields);
    return reply.send({ success: true });
  });

  app.delete("/admin/api/services/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteBackendService(db, id);
    return reply.send({ success: true });
  });

  done();
};
