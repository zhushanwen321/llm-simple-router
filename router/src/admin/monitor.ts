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

  app.get("/admin/api/monitor/init", async () => {
    const [activeResult, recentResult, statsResult, concurrencyResult, runtimeResult] = await Promise.allSettled([
      tracker.getActive(),
      tracker.getRecent(),
      tracker.getStats(),
      tracker.getConcurrency(),
      tracker.getRuntime(),
    ]);

    return {
      active: activeResult.status === "fulfilled" ? activeResult.value : null,
      recent: recentResult.status === "fulfilled" ? recentResult.value : null,
      stats: statsResult.status === "fulfilled" ? statsResult.value : null,
      concurrency: concurrencyResult.status === "fulfilled" ? concurrencyResult.value : null,
      runtime: runtimeResult.status === "fulfilled" ? runtimeResult.value : null,
    };
  });

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

    // writeHead 必须在 addClient 之前调用，否则 sendInitialSnapshot 的 write()
    // 会触发 Node.js 隐式 header 发送（Content-Type 默认非 text/event-stream），
    // 导致浏览器 EventSource 解析失败、不断重连。
    try {
      reply.raw.writeHead(HTTP_OK, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
    } catch {
      request.log.debug("client disconnected before writeHead");
      return;
    }

    const sseClient = adaptSSEClient(reply.raw);
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
