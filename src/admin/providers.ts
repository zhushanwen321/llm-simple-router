import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import type { Provider } from "../db/index.js";
import { getAllProviders, getProviderById, createProvider, updateProvider, deleteProvider, getAllMappingGroups } from "../db/index.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT } from "./constants.js";

const API_KEY_PREVIEW_MIN_LEN = 8;
const API_KEY_PREVIEW_PREFIX_LEN = 4;
const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const CreateProviderSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  api_type: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
  base_url: Type.String({ minLength: 1 }),
  api_key: Type.String({ minLength: 1 }),
  models: Type.Optional(Type.Array(Type.String())),
  is_active: Type.Optional(Type.Number()),
});

const UpdateProviderSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  api_type: Type.Optional(Type.Union([Type.Literal("openai"), Type.Literal("anthropic")])),
  base_url: Type.Optional(Type.String({ minLength: 1 })),
  api_key: Type.Optional(Type.String({ minLength: 1 })),
  models: Type.Optional(Type.Array(Type.String())),
  is_active: Type.Optional(Type.Number()),
});

interface ProviderRoutesOptions {
  db: Database.Database;
}

export const adminProviderRoutes: FastifyPluginCallback<ProviderRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/providers", async (_request, reply) => {
    const encryptionKey = getSetting(db, "encryption_key")!;
    const providers = getAllProviders(db);
    return reply.send(providers.map((s) => ({
      id: s.id,
      name: s.name,
      api_type: s.api_type,
      base_url: s.base_url,
      api_key: s.api_key ? decrypt(s.api_key, encryptionKey) : "",
      models: JSON.parse(s.models || "[]"),
      is_active: s.is_active,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })));
  });

  app.post("/admin/api/providers", { schema: { body: CreateProviderSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateProviderSchema>;
    if (!PROVIDER_NAME_RE.test(body.name)) {
      return reply.status(400).send({ error: { message: "Provider 名称仅允许英文大小写字母、数字、横线和下划线" } });
    }
    const encryptedKey = encrypt(body.api_key, getSetting(db, "encryption_key")!);
    const id = createProvider(db, {
      name: body.name,
      api_type: body.api_type,
      base_url: body.base_url,
      api_key: encryptedKey,
      api_key_preview: body.api_key.length > 8 ? `${body.api_key.slice(0, 4)}...${body.api_key.slice(-4)}` : "****",
      models: JSON.stringify(body.models ?? []),
      is_active: body.is_active ?? 1,
    });
    return reply.code(HTTP_CREATED).send({ id });
  });

  app.put("/admin/api/providers/:id", { schema: { body: UpdateProviderSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getProviderById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Provider not found" } });
    }
    const body = request.body as Static<typeof UpdateProviderSchema>;
    if (body.name !== undefined && !PROVIDER_NAME_RE.test(body.name)) {
      return reply.status(400).send({ error: { message: "Provider 名称仅允许英文大小写字母、数字、横线和下划线" } });
    }
    const fields: Partial<Pick<Provider, 'name' | 'api_type' | 'base_url' | 'api_key' | 'api_key_preview' | 'models' | 'is_active'>> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.api_type !== undefined) fields.api_type = body.api_type;
    if (body.base_url !== undefined) fields.base_url = body.base_url;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    if (body.models !== undefined) fields.models = JSON.stringify(body.models);
    if (body.api_key) {
      fields.api_key = encrypt(body.api_key, getSetting(db, "encryption_key")!);
      fields.api_key_preview = body.api_key.length > 8 ? `${body.api_key.slice(0, 4)}...${body.api_key.slice(-4)}` : "****";
    }
    updateProvider(db, id, fields);
    return reply.send({ success: true });
  });

  app.delete("/admin/api/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const groups = getAllMappingGroups(db);
    for (const g of groups) {
      try {
        const rule = JSON.parse(g.rule);
        const targets = [rule.default, ...(rule.windows || [])].filter(Boolean);
        if (targets.some((t: any) => t.provider_id === id)) {
          return reply.code(HTTP_CONFLICT).send({ error: { message: `Provider is referenced by mapping group '${g.client_model}'` } });
        }
      } catch { /* rule format invalid, skip */ }
    }
    deleteProvider(db, id);
    return reply.send({ success: true });
  });

  done();
};
