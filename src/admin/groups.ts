import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import type { MappingGroup } from "../db/index.js";
import {
  getAllMappingGroups,
  createMappingGroup,
  updateMappingGroup,
  deleteMappingGroup,
  getProviderById,
  getMappingGroupById,
} from "../db/index.js";
import { STRATEGY_NAMES } from "../proxy/strategy/types.js";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_CONFLICT } from "./constants.js";

const MIN_FAILOVER_TARGETS = 2;

const CreateGroupSchema = Type.Object({
  client_model: Type.String({ minLength: 1 }),
  strategy: Type.String({ minLength: 1 }),
  rule: Type.String(),
});

const UpdateGroupSchema = Type.Object({
  client_model: Type.Optional(Type.String({ minLength: 1 })),
  strategy: Type.Optional(Type.String({ minLength: 1 })),
  rule: Type.Optional(Type.String()),
});

interface GroupRoutesOptions {
  db: Database.Database;
}

type ScheduledRuleDefault = TargetInput;

interface TargetInput {
  backend_model?: string;
  provider_id?: string;
}

interface ScheduledRuleWindow {
  start: string;
  end: string;
  target: TargetInput;
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
  const VALID_STRATEGIES: Set<string> = new Set(Object.values(STRATEGY_NAMES));
  if (!VALID_STRATEGIES.has(strategy)) {
    return `Unknown strategy '${strategy}'. Valid: ${[...VALID_STRATEGIES].join(", ")}`;
  }

  let rule: unknown;
  try {
    rule = JSON.parse(ruleJson);
  } catch {
    return "Invalid rule JSON";
  }

  if (strategy === STRATEGY_NAMES.SCHEDULED) {
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

  if (strategy === STRATEGY_NAMES.ROUND_ROBIN || strategy === STRATEGY_NAMES.RANDOM || strategy === STRATEGY_NAMES.FAILOVER) {
    const r = rule as { targets?: unknown[] };
    if (!Array.isArray(r.targets) || r.targets.length === 0) {
      return "rule.targets must be a non-empty array";
    }
    const minTargets = strategy === STRATEGY_NAMES.FAILOVER ? MIN_FAILOVER_TARGETS : 1;
    if (r.targets.length < minTargets) {
      return `strategy '${strategy}' requires at least ${minTargets} target(s)`;
    }
    for (let i = 0; i < r.targets.length; i++) {
      const t = r.targets[i] as TargetInput;
      if (!t.backend_model || !t.provider_id) {
        return `targets[${i}] missing backend_model or provider_id`;
      }
      const p = getProviderById(db, t.provider_id);
      if (!p) {
        return `targets[${i}] provider_id '${t.provider_id}' not found`;
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

  app.post("/admin/api/mapping-groups", { schema: { body: CreateGroupSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof CreateGroupSchema>;
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

  app.put("/admin/api/mapping-groups/:id", { schema: { body: UpdateGroupSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Static<typeof UpdateGroupSchema>;
    const fields: Partial<Pick<MappingGroup, "client_model" | "strategy" | "rule">> = {};
    if (body.client_model !== undefined) fields.client_model = body.client_model;
    if (body.strategy !== undefined) fields.strategy = body.strategy;
    if (body.rule !== undefined) fields.rule = body.rule;

    const strategy = body.strategy ?? findGroupStrategy(db, id);
    const ruleJson = body.rule ?? findGroupRule(db, id);
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

function findGroupStrategy(db: Database.Database, id: string): string {
  const g = getMappingGroupById(db, id);
  return g?.strategy ?? STRATEGY_NAMES.SCHEDULED;
}

function findGroupRule(db: Database.Database, id: string): string {
  const g = getMappingGroupById(db, id);
  return g?.rule ?? "{}";
}
