import { FastifyPluginCallback } from "fastify";
import type { RequestTracker } from "../monitor/request-tracker.js";

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
  app.get("/admin/api/monitor/stats", async () => tracker.getStats());
  app.get("/admin/api/monitor/concurrency", async () => tracker.getConcurrency());
  app.get("/admin/api/monitor/runtime", async () => tracker.getRuntime());

  app.get("/admin/api/monitor/stream", (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    tracker.addClient(reply.raw);
    request.raw.on("close", () => {
      tracker.removeClient(reply.raw);
    });
  });

  done();
};
