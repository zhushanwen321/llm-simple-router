import { FastifyPluginCallback } from "fastify";
import type { RequestTracker } from "llm-router-core/monitor";
import { adaptSSEClient } from "../core/sse-client-adapter.js";
import { HTTP_NOT_FOUND } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

const HTTP_OK = 200;

interface MonitorRoutesOptions {
  tracker?: RequestTracker;
}

export const adminMonitorRoutes: FastifyPluginCallback<MonitorRoutesOptions> = (app, options, done) => {
  const { tracker } = options;

  if (!tracker) {
    done();
    return;
  }

  app.get("/admin/api/monitor/active", async () => tracker.getActive());
  app.get("/admin/api/monitor/recent", async () => tracker.getRecent());
  app.get("/admin/api/monitor/stats", async () => tracker.getStats());
  app.get("/admin/api/monitor/concurrency", async () => tracker.getConcurrency());
  app.get("/admin/api/monitor/runtime", async () => tracker.getRuntime());

  app.get("/admin/api/monitor/stream", (request, reply) => {
    // hijack() 让 Fastify 完全放弃响应管理，避免 onSend hook 向 SSE 流注入信封 JSON
    reply.hijack();
    reply.raw.writeHead(HTTP_OK, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const sseClient = adaptSSEClient(reply.raw);
    tracker.addClient(sseClient);
    request.raw.on("close", () => {
      tracker.removeClient(sseClient);
    });
  });

  app.get("/admin/api/monitor/request/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const req = tracker.getRequestById(id);
    if (!req) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Not found"));
    return req;
  });

  done();
};
