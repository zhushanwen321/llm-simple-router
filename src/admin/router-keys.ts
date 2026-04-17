import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { randomBytes, createHash } from "crypto";
import { Type, Static } from "@sinclair/typebox";
import { encrypt, decrypt } from "../utils/crypto.js";
import {
  getAllRouterKeys, getRouterKeyById, createRouterKey, updateRouterKey, deleteRouterKey, getAvailableModels,
} from "../db/index.js";
import type { RouterKey } from "../db/index.js";
import { getSetting } from "../db/settings.js";

const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const KEY_RANDOM_BYTES = 32;
const KEY_PREFIX_LENGTH = 8;

/** 归一化 allowed_models：null/空数组/仅含空字符串 → null（允许所有模型） */
function normalizeAllowedModels(val: string[] | null | undefined): string | null {
  if (!val) return null;
  const filtered = val.filter((m) => m.trim() !== "");
  return filtered.length > 0 ? JSON.stringify(filtered) : null;
}

const CreateRouterKeySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  allowed_models: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
});

const UpdateRouterKeySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  allowed_models: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  is_active: Type.Optional(Type.Number()),
});

interface RouterKeyRoutesOptions {
  db: Database.Database;
}

function generateRouterKey(db: Database.Database): { key: string; hash: string; prefix: string; encrypted: string } {
  const key = `sk-router-${randomBytes(KEY_RANDOM_BYTES).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, KEY_PREFIX_LENGTH);
  const encrypted = encrypt(key, getSetting(db, "encryption_key")!);
  return { key, hash, prefix, encrypted };
}

function toPublicRouterKey(rk: RouterKey, db: Database.Database) {
  const encryptionKey = getSetting(db, "encryption_key")!;
  return {
    id: rk.id,
    name: rk.name,
    key_prefix: rk.key_prefix,
    key: rk.key_encrypted ? decrypt(rk.key_encrypted, encryptionKey) : null,
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
    return reply.send(keys.map((rk) => toPublicRouterKey(rk, db)));
  });

  app.post("/admin/api/router-keys", { schema: { body: CreateRouterKeySchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateRouterKeySchema>;
    const { key, hash, prefix, encrypted } = generateRouterKey(db);
    const allowedModels = normalizeAllowedModels(body.allowed_models);
    const id = createRouterKey(db, { name: body.name, key_hash: hash, key_prefix: prefix, key_encrypted: encrypted, allowed_models: allowedModels });
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

  app.put("/admin/api/router-keys/:id", { schema: { body: UpdateRouterKeySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getRouterKeyById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Router key not found" } });
    }
    const body = request.body as Static<typeof UpdateRouterKeySchema>;
    const fields: Partial<Pick<RouterKey, 'name' | 'allowed_models' | 'is_active'>> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.allowed_models !== undefined) fields.allowed_models = normalizeAllowedModels(body.allowed_models);
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
