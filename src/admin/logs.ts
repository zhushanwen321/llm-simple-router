import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getRequestLogs, getRequestLogsGrouped, getRequestLogById, getRequestLogChildren, deleteLogsBefore } from "../db/index.js";
import { HTTP_NOT_FOUND } from "./constants.js";

const LogQuerySchema = Type.Object({
  page: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  api_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  provider_id: Type.Optional(Type.String()),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
  view: Type.Optional(Type.Literal("grouped")),
});

const DeleteLogsBeforeSchema = Type.Object({
  before: Type.String({ minLength: 1 }),
});

const DEFAULT_LOG_VIEW = "flat";

interface LogRoutesOptions {
  db: Database.Database;
}

export const adminLogRoutes: FastifyPluginCallback<LogRoutesOptions> = (app, options, done) => {
  const { db } = options;

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
      router_key_id: query.router_key_id || undefined,
      provider_id: query.provider_id || undefined,
      start_time: query.start_time || undefined,
      end_time: query.end_time || undefined,
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
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Log not found" } });
    }
    return reply.send({ data: log });
  });

  app.get("/admin/api/logs/:id/children", async (request, reply) => {
    const params = request.params as { id: string };
    const parent = getRequestLogById(db, params.id);
    if (!parent) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Log not found" } });
    }
    const rows = getRequestLogChildren(db, params.id);
    return reply.send({ data: rows });
  });

  app.delete("/admin/api/logs/before", { schema: { body: DeleteLogsBeforeSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof DeleteLogsBeforeSchema>;
    const deleted = deleteLogsBefore(db, body.before);
    return reply.send({ deleted });
  });

  done();
};
