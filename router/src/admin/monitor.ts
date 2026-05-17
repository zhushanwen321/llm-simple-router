import { FastifyPluginCallback } from "fastify";
import type { RequestTracker } from "../core/monitor/index.js";
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

    // 客户端在 hijack 之前已断连，无需发送响应头
    if (reply.raw.destroyed) return;

    // 先发送 HTTP response headers，再 addClient（内部会 sendInitialSnapshot）。
    // 确保 SSE event 数据在 headers 之后到达客户端，避免 Node.js 隐式 writeHead
    // 导致后续显式 writeHead 抛 ERR_HTTP_HEADERS_SENT。
    try {
      reply.raw.writeHead(HTTP_OK, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
    } catch (err) {
      request.log.debug({ err }, "client disconnected before writeHead");
      return;
    }

    const sseClient = adaptSSEClient(reply.raw);
    // 在 close handler 之前 addClient，确保 sendInitialSnapshot 写入的数据
    // 在 close 事件触发前到达客户端（close handler 中 removeClient 会停止广播）
    tracker.addClient(sseClient);

    reply.raw.on("close", () => {
      tracker.removeClient(sseClient);
    });
  });

  app.get("/admin/api/monitor/request/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const req = tracker.getRequestById(id);
    if (!req) return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Not found"));
    return req;
  });

  app.delete("/admin/api/monitor/request/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const killed = tracker.killRequest(id);
    if (!killed) {
      return reply.code(HTTP_NOT_FOUND).send(apiError(API_CODE.NOT_FOUND, "Request not found or already completed"));
    }
    return { killed: true };
  });

  done();
};
