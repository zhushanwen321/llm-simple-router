import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getRequestLogs, getRequestLogById, deleteLogsBefore } from "../db/index.js";
import { HTTP_NOT_FOUND } from "./constants.js";

const LogQuerySchema = Type.Object({
  page: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  api_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
});

const DeleteLogsBeforeSchema = Type.Object({
  before: Type.String({ minLength: 1 }),
});

interface LogRoutesOptions {
  db: Database.Database;
}

export const adminLogRoutes: FastifyPluginCallback<LogRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/logs", { schema: { querystring: LogQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof LogQuerySchema>;
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "20", 10);
    const result = getRequestLogs(db, {
      page,
      limit,
      api_type: query.api_type || undefined,
      model: query.model || undefined,
      router_key_id: query.router_key_id || undefined,
    });
    return reply.send({ ...result, page, limit });
  });

  app.get("/admin/api/logs/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const log = getRequestLogById(db, params.id);
    if (!log) {
      return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Log not found" } });
    }
    return reply.send(log);
  });

  app.delete("/admin/api/logs/before", { schema: { body: DeleteLogsBeforeSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof DeleteLogsBeforeSchema>;
    const deleted = deleteLogsBefore(db, body.before);
    return reply.send({ deleted });
  });

  done();
};
