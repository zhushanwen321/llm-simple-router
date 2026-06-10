import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getRequestLogs, getRequestLogsGrouped, getRequestLogById, getRequestLogChildren, deleteLogsBefore, extractThinkingLevel, getAllProviders, getAllRouterKeys, getAllMappingGroups } from "../db/index.js";
import { getLogRetentionDays } from "../db/settings.js";
import type { LogFileWriter } from "../storage/log-file-writer.js";
import { HTTP_NOT_FOUND } from "../core/constants.js";
import { API_CODE, apiError } from "./api-response.js";

const LogQuerySchema = Type.Object({
  page: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  api_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  client_model: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  provider_id: Type.Optional(Type.String()),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
  status_code: Type.Optional(Type.String()),
  view: Type.Optional(Type.Literal("grouped")),
});

const DeleteLogsBeforeSchema = Type.Object({
  before: Type.String({ minLength: 1 }),
});

const DEFAULT_LOG_VIEW = "flat";

interface LogRoutesOptions {
  db: Database.Database;
  logFileWriter?: LogFileWriter | null;
}

export const adminLogRoutes: FastifyPluginCallback<LogRoutesOptions> = (app, options, done) => {
  const { db, logFileWriter } = options;

  app.get("/admin/api/logs/init", async () => {
    const [providersResult, routerKeysResult, groupsResult, retentionResult] = await Promise.allSettled([
      Promise.resolve(getAllProviders(db).map(p => ({ id: p.id, name: p.name }))),
      Promise.resolve(getAllRouterKeys(db).map(rk => ({ id: rk.id, name: rk.name }))),
      (async () => {
        const groups = getAllMappingGroups(db);
        const clientModels = [...new Set(groups.filter(g => g.is_active).map(g => g.client_model))].sort();
        const backendModels = [...new Set(groups.flatMap(g => {
          try {
            const rule = JSON.parse(g.rule);
            return (Array.isArray(rule.targets) ? rule.targets : []).map((t: { backend_model?: string }) => t.backend_model);
          } catch { return [] }
        }).filter(Boolean))].sort();
        return { client_models: clientModels, backend_models: backendModels };
      })(),
      Promise.resolve(getLogRetentionDays(db)),
    ]);

    return {
      providers: providersResult.status === "fulfilled" ? providersResult.value : null,
      router_keys: routerKeysResult.status === "fulfilled" ? routerKeysResult.value : null,
      client_models: groupsResult.status === "fulfilled" ? groupsResult.value.client_models : null,
      backend_models: groupsResult.status === "fulfilled" ? groupsResult.value.backend_models : null,
      log_retention_days: retentionResult.status === "fulfilled" ? retentionResult.value : null,
    };
  });

  app.get("/admin/api/logs", { schema: { querystring: LogQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof LogQuerySchema>;
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "20", 10);
    const view = query.view || DEFAULT_LOG_VIEW;

    const listOptions = {
      page,
      limit,
      api_type: query.api_type || undefined,
      model: query.model || undefined,
      client_model: query.client_model || undefined,
      backend_model: query.backend_model || undefined,
      router_key_id: query.router_key_id || undefined,
      provider_id: query.provider_id || undefined,
      start_time: query.start_time || undefined,
      end_time: query.end_time || undefined,
      status_code: query.status_code || undefined,
    };

    const result = view === "grouped"
      ? getRequestLogsGrouped(db, listOptions)
      : getRequestLogs(db, listOptions);
    return reply.send({ ...result, page, limit });
  });

  app.get("/admin/api/logs/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const log = getRequestLogById(db, params.id);
    if (!log) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Log not found"));
    }

    // DB 字段为 null 时，从 JSONL 文件回填详情
    const needsBackfill = log.client_request === null || log.upstream_request === null || log.upstream_response === null;
    if (needsBackfill && logFileWriter && logFileWriter.isEnabled && log.created_at) {
      const fileEntry = logFileWriter.read(log.id, log.created_at);
      if (fileEntry) {
        if (log.client_request === null && fileEntry.client_request !== null) {
          log.client_request = fileEntry.client_request;
        }
        if (log.upstream_request === null && fileEntry.upstream_request !== null) {
          log.upstream_request = fileEntry.upstream_request;
        }
        if (log.upstream_response === null && fileEntry.upstream_response !== null) {
          log.upstream_response = fileEntry.upstream_response;
        }
      }
    }

    // JSONL 回填后重新提取 thinking level（覆盖 SQL 层因 client_request 为 null 得出的 'off'）
    // 兼容历史数据：thinking_level === 'off' 且 client_request 存在时重新计算
    if (log.thinking_level === 'off' && log.client_request) {
      const computed = extractThinkingLevel(log.api_type, log.client_request);
      if (computed !== 'off') {
        log.thinking_level = computed;
      }
    }

    return reply.send(log);
  });

  app.get("/admin/api/logs/:id/children", async (request, reply) => {
    const params = request.params as { id: string };
    const parent = getRequestLogById(db, params.id);
    if (!parent) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Log not found"));
    }
    const rows = getRequestLogChildren(db, params.id);
    return reply.send(rows);
  });

  app.delete("/admin/api/logs/before", { schema: { body: DeleteLogsBeforeSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof DeleteLogsBeforeSchema>;
    const deleted = deleteLogsBefore(db, body.before);
    return reply.send({ deleted });
  });

  done();
};
