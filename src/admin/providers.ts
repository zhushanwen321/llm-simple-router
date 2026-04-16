import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import type { Provider } from "../db/index.js";
import { getAllProviders, getProviderById, createProvider, updateProvider, deleteProvider, getAllMappingGroups } from "../db/index.js";
import { encrypt } from "../utils/crypto.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT } from "./constants.js";

const API_KEY_PREVIEW_MIN_LEN = 8;
const API_KEY_PREVIEW_PREFIX_LEN = 4;

interface CreateProviderBody {
  name: string;
  api_type: string;
  base_url: string;
  api_key: string;
  is_active?: number;
}

interface UpdateProviderBody {
  name?: string;
  api_type?: string;
  base_url?: string;
  api_key?: string;
  is_active?: number;
}

interface ProviderRoutesOptions {
  db: Database.Database;
  encryptionKey: string;
}

function computeApiKeyPreview(apiKey: string): string {
  if (apiKey.length <= API_KEY_PREVIEW_MIN_LEN) return "****";
  return `${apiKey.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${apiKey.slice(-API_KEY_PREVIEW_PREFIX_LEN)}`;
}

export const adminProviderRoutes: FastifyPluginCallback<ProviderRoutesOptions> = (app, options, done) => {
  const { db, encryptionKey } = options;

  app.get("/admin/api/providers", async (_request, reply) => {
    const providers = getAllProviders(db);
    return reply.send(providers.map((s) => ({
      id: s.id,
      name: s.name,
      api_type: s.api_type,
      base_url: s.base_url,
      api_key_preview: s.api_key_preview || "****",
      is_active: s.is_active,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })));
  });

  app.post("/admin/api/providers", async (request, reply) => {
    const body = request.body as CreateProviderBody;
    if (!body.name || !body.api_type || !body.base_url || !body.api_key) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "Missing required fields: name, api_type, base_url, api_key" } });
    }
    if (!["openai", "anthropic"].includes(body.api_type)) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "api_type must be 'openai' or 'anthropic'" } });
    }
    const encryptedKey = encrypt(body.api_key, encryptionKey);
    const apiKeyPreview = computeApiKeyPreview(body.api_key);
    const id = createProvider(db, {
      name: body.name,
      api_type: body.api_type as "openai" | "anthropic",
      base_url: body.base_url,
      api_key: encryptedKey,
      api_key_preview: apiKeyPreview,
      is_active: body.is_active ?? 1,
    });
    return reply.code(HTTP_CREATED).send({ id });
  });

  app.put("/admin/api/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getProviderById(db, id);
    if (!existing) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Provider not found" } });
    }
    const body = request.body as UpdateProviderBody;
    const fields: Partial<Pick<Provider, 'name' | 'api_type' | 'base_url' | 'api_key' | 'api_key_preview' | 'is_active'>> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.api_type !== undefined) fields.api_type = body.api_type as "openai" | "anthropic";
    if (body.base_url !== undefined) fields.base_url = body.base_url;
    if (body.is_active !== undefined) fields.is_active = body.is_active;
    if (body.api_key) {
      fields.api_key = encrypt(body.api_key, encryptionKey);
      fields.api_key_preview = computeApiKeyPreview(body.api_key);
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
