import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { randomBytes, createHash } from "crypto";
import {
  getAllRouterKeys, getRouterKeyById, createRouterKey, updateRouterKey, deleteRouterKey, getAvailableModels,
} from "../db/index.js";
import type { RouterKey } from "../db/index.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const KEY_RANDOM_BYTES = 32;
const KEY_PREFIX_LENGTH = 8;

interface CreateRouterKeyBody {
  name: string;
  allowed_models?: string[] | null;
}

interface UpdateRouterKeyBody {
  name?: string;
  allowed_models?: string[] | null;
  is_active?: number;
}

interface RouterKeyRoutesOptions {
  db: Database.Database;
}

function generateRouterKey(): { key: string; hash: string; prefix: string } {
  const key = `sk-router-${randomBytes(KEY_RANDOM_BYTES).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, KEY_PREFIX_LENGTH);
  return { key, hash, prefix };
}

function toPublicRouterKey(rk: RouterKey) {
  return {
    id: rk.id,
    name: rk.name,
    key_prefix: rk.key_prefix,
    allowed_models: rk.allowed_models ? JSON.parse(rk.allowed_models) : null,
    is_active: rk.is_active,
    created_at: rk.created_at,
    updated_at: rk.updated_at,
  };
}

export const adminRouterKeyRoutes: FastifyPluginCallback<RouterKeyRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/router-keys", async (_request, reply) => {
    const keys = getAllRouterKeys(db);
    return reply.send(keys.map(toPublicRouterKey));
  });

  app.post("/admin/api/router-keys", async (request, reply) => {
    const body = request.body as CreateRouterKeyBody;
    if (!body.name) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "Missing required field: name" } });
    }
    const { key, hash, prefix } = generateRouterKey();
    const allowedModels = body.allowed_models ? JSON.stringify(body.allowed_models) : null;
    const id = createRouterKey(db, { name: body.name, key_hash: hash, key_prefix: prefix, allowed_models: allowedModels });
    return reply.code(HTTP_CREATED).send({
      id,
      name: body.name,
      key,
      key_prefix: prefix,
      allowed_models: body.allowed_models ?? null,
      is_active: true,
      created_at: new Date().toISOString(),
    });
  });

  app.put("/admin/api/router-keys/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getRouterKeyById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Router key not found" } });
    }
    const body = request.body as UpdateRouterKeyBody;
    const fields: Partial<Pick<RouterKey, 'name' | 'allowed_models' | 'is_active'>> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.allowed_models !== undefined) fields.allowed_models = JSON.stringify(body.allowed_models);
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    updateRouterKey(db, id, fields);
    return reply.send({ success: true });
  });

  app.delete("/admin/api/router-keys/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteRouterKey(db, id);
    return reply.send({ success: true });
  });

  app.get("/admin/api/models/available", async (_request, reply) => {
    const models = getAvailableModels(db);
    return reply.send(models);
  });

  done();
};
