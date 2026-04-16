import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { getRequestLogs, getRequestLogById, deleteLogsBefore } from "../db/index.js";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "./constants.js";

interface LogQueryParams {
  page?: string;
  limit?: string;
  api_type?: string;
  model?: string;
  router_key_id?: string;
}

interface LogRoutesOptions {
  db: Database.Database;
}

export const adminLogRoutes: FastifyPluginCallback<LogRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/logs", async (request, reply) => {
    const query = request.query as LogQueryParams;
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

  app.delete("/admin/api/logs/before", async (request, reply) => {
    const body = request.body as { before?: string };
    if (!body.before) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: "Missing required field: before" } });
    }
    const deleted = deleteLogsBefore(db, body.before);
    return reply.send({ deleted });
  });

  done();
};
