import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getSetting, setSetting } from "../db/settings.js";
import { parseModels, COMPACT_THRESHOLD } from "../config/model-context.js";
import { getActiveProvidersWithModels } from "../db/index.js";

export const DEFAULT_COMPACT_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

Your task is to create a detailed summary of the conversation so far. The summary should be comprehensive and capture all key details.

Structure your response as follows:

<analysis>
- Brief notes on what to include in the summary
</analysis>

<summary>
1. **Primary Request and Intent**: What the user asked for and their goal
2. **Key Technical Concepts**: Important technologies, frameworks, patterns mentioned
3. **Files and Code Sections**: Key files read/modified with relevant code snippets
4. **Errors and Fixes**: Any errors encountered and how they were resolved
5. **Problem Solving**: The approach taken and reasoning
6. **All User Messages**: Paraphrased list of all user messages
7. **Pending Tasks**: Any incomplete tasks or TODOs
8. **Current Work**: Precisely describe what was being worked on when context ran out
9. **Optional Next Step**: Suggested next action based on the most recent conversation
</summary>

REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.`;

const UpdateProxyEnhancementSchema = Type.Object({
  claude_code_enabled: Type.Boolean(),
  context_compact_enabled: Type.Boolean(),
  compact_provider_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  compact_model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  custom_prompt_enabled: Type.Boolean(),
  custom_prompt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const SessionParamsSchema = Type.Object({
  keyId: Type.String(),
  sessionId: Type.String(),
});
import {
  getSessionStates,
  getSessionHistory,
} from "../db/session-states.js";
import { modelState } from "../proxy/model-state.js";

interface ProxyEnhancementOptions {
  db: Database.Database;
}

interface ProxyEnhancementConfig {
  claude_code_enabled: boolean;
  context_compact_enabled: boolean;
  compact_provider_id: string | null;
  compact_model: string | null;
  custom_prompt_enabled: boolean;
  custom_prompt: string | null;
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/proxy-enhancement", async (_request, reply) => {
    const raw = getSetting(db, "proxy_enhancement");
    const parsed = raw ? JSON.parse(raw) : {};
    const config = typeof parsed === "object" && parsed !== null ? parsed : {};
    return reply.send({
      claude_code_enabled: config.claude_code_enabled ?? false,
      context_compact_enabled: config.context_compact_enabled ?? false,
      compact_provider_id: config.compact_provider_id ?? null,
      compact_model: config.compact_model ?? null,
      custom_prompt_enabled: config.custom_prompt_enabled ?? false,
      custom_prompt: config.custom_prompt ?? null,
      default_compact_prompt: DEFAULT_COMPACT_PROMPT,
    });
  });

  app.put("/admin/api/proxy-enhancement", { schema: { body: UpdateProxyEnhancementSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof UpdateProxyEnhancementSchema>;
    const config: ProxyEnhancementConfig = {
      claude_code_enabled: body.claude_code_enabled,
      context_compact_enabled: body.context_compact_enabled,
      compact_provider_id: body.compact_provider_id ?? null,
      compact_model: body.compact_model ?? null,
      custom_prompt_enabled: body.custom_prompt_enabled,
      custom_prompt: body.custom_prompt ?? null,
    };
    setSetting(db, "proxy_enhancement", JSON.stringify(config));
    return reply.send({ success: true });
  });

  app.get("/admin/api/proxy-enhancement/compact-models", async (_request, reply) => {
    const providers = getActiveProvidersWithModels(db);
    const result: Array<{ provider_id: string; provider_name: string; model: string; context_window: number }> = [];
    for (const p of providers) {
      const models = parseModels(p.models);
      for (const m of models) {
        if (m.context_window && m.context_window >= COMPACT_THRESHOLD) {
          result.push({ provider_id: p.id, provider_name: p.name, model: m.name, context_window: m.context_window });
        }
      }
    }
    return reply.send(result);
  });

  app.get("/admin/api/session-states", async (_req, reply) => {
    const states = getSessionStates(db);
    return reply.send(states);
  });

  app.get(
    "/admin/api/session-states/:keyId/:sessionId/history",
    { schema: { params: SessionParamsSchema } },
    async (req, reply) => {
      const { keyId, sessionId } = req.params as { keyId: string; sessionId: string };
      const history = getSessionHistory(db, keyId, sessionId);
      return reply.send(history);
    },
  );

  app.delete(
    "/admin/api/session-states/:keyId/:sessionId",
    { schema: { params: SessionParamsSchema } },
    async (req, reply) => {
      const { keyId, sessionId } = req.params as { keyId: string; sessionId: string };
      modelState.delete(keyId, sessionId);
      return reply.send({ success: true });
    },
  );

  done();
};
