import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import type { MappingGroup } from "../db/index.js";
import {
  getAllMappingGroups,
  createMappingGroup,
  updateMappingGroup,
  deleteMappingGroup,
  getProviderById,
} from "../db/index.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_CONFLICT } from "./constants.js";

interface CreateGroupBody {
  client_model: string;
  strategy: string;
  rule: string;
}

interface UpdateGroupBody {
  client_model?: string;
  strategy?: string;
  rule?: string;
}

interface GroupRoutesOptions {
  db: Database.Database;
}

interface ScheduledRuleDefault {
  backend_model?: string;
  provider_id?: string;
}

interface ScheduledRuleWindow {
  start: string;
  end: string;
  target: {
    backend_model: string;
    provider_id: string;
  };
}

interface ScheduledRule {
  default?: ScheduledRuleDefault;
  windows?: ScheduledRuleWindow[];
}

async function validateRule(
  db: Database.Database,
  strategy: string,
  ruleJson: string
): Promise<string | undefined> {
  let rule: unknown;
  try {
    rule = JSON.parse(ruleJson);
  } catch {
    return "Invalid rule JSON";
  }

  if (strategy === "scheduled") {
    const r = rule as ScheduledRule;
    if (!r.default || !r.default.backend_model || !r.default.provider_id) {
      return "rule.default.backend_model and rule.default.provider_id are required";
    }
    const defaultProvider = getProviderById(db, r.default.provider_id);
    if (!defaultProvider) {
      return `provider_id '${r.default.provider_id}' not found`;
    }

    if (r.windows !== undefined && !Array.isArray(r.windows)) {
      return "rule.windows must be an array";
    }
    if (Array.isArray(r.windows)) {
      for (let i = 0; i < r.windows.length; i++) {
        const w = r.windows[i];
        if (!w.start || !w.end || !w.target || !w.target.backend_model || !w.target.provider_id) {
          return `window[${i}] missing start/end/target.backend_model/target.provider_id`;
        }
        const p = getProviderById(db, w.target.provider_id);
        if (!p) {
          return `window[${i}] provider_id '${w.target.provider_id}' not found`;
        }
      }
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

  app.post("/admin/api/mapping-groups", async (request, reply) => {
    const body = request.body as CreateGroupBody;
    if (!body.client_model || !body.strategy || body.rule === undefined) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "Missing required fields: client_model, strategy, rule" } });
    }
    const validationError = await validateRule(db, body.strategy, body.rule);
    if (validationError) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: validationError } });
    }
    try {
      const id = createMappingGroup(db, {
        client_model: body.client_model,
        strategy: body.strategy,
        rule: body.rule,
      });
      return reply.code(HTTP_CREATED).send({ id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send({ error: { message: "client_model already exists" } });
      }
      throw err;
    }
  });

  app.put("/admin/api/mapping-groups/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as UpdateGroupBody;
    const fields: Partial<Pick<MappingGroup, "client_model" | "strategy" | "rule">> = {};
    if (body.client_model !== undefined) fields.client_model = body.client_model;
    if (body.strategy !== undefined) fields.strategy = body.strategy;
    if (body.rule !== undefined) fields.rule = body.rule;

    const strategy = body.strategy ?? (await findGroupStrategy(db, id));
    const ruleJson = body.rule ?? (await findGroupRule(db, id));
    const validationError = await validateRule(db, strategy, ruleJson);
    if (validationError) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: validationError } });
    }

    try {
      updateMappingGroup(db, id, fields);
      return reply.send({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return reply.code(HTTP_CONFLICT).send({ error: { message: "client_model already exists" } });
      }
      throw err;
    }
  });

  app.delete("/admin/api/mapping-groups/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deleteMappingGroup(db, id);
    return reply.send({ success: true });
  });

  done();
};

async function findGroupStrategy(db: Database.Database, id: string): Promise<string> {
  const groups = getAllMappingGroups(db);
  const g = groups.find((x) => x.id === id);
  return g?.strategy ?? "scheduled";
}

async function findGroupRule(db: Database.Database, id: string): Promise<string> {
  const groups = getAllMappingGroups(db);
  const g = groups.find((x) => x.id === id);
  return g?.rule ?? "{}";
}
