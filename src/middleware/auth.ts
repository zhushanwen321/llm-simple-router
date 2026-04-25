import { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "crypto";
import fp from "fastify-plugin";
import Database from "better-sqlite3";
import { isInitialized } from "../db/settings.js";
import { insertRequestLog } from "../db/logs.js";
import { getProxyApiType } from "../constants.js";

declare module "fastify" {
  interface FastifyRequest {
    // allowed_models 是 JSON 字符串，需 JSON.parse
    routerKey?: { id: string; name: string; allowed_models: string | null };
  }
}

interface RouterKeyRow { id: string; name: string; allowed_models: string | null; }

const SKIP_PATHS = ["/health", "/admin"];
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;
const BEARER_PREFIX_LENGTH = "Bearer ".length;

function shouldSkipAuth(url: string): boolean {
  const path = url.split("?")[0];
  return SKIP_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/")
  );
}

function unauthorizedReply(reply: FastifyReply): void {
  reply.code(HTTP_UNAUTHORIZED).send({
    error: {
      message: "Invalid API key",
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  });
}

function logRejectedAuth(
  db: Database.Database,
  apiType: string,
  statusCode: number,
  errorMessage: string,
  request: FastifyRequest,
): void {
  insertRequestLog(db, {
    id: randomUUID(),
    api_type: apiType,
    model: null,
    provider_id: null,
    status_code: statusCode,
    latency_ms: 0,
    is_stream: 0,
    error_message: errorMessage,
    created_at: new Date().toISOString(),
    client_request: JSON.stringify({ headers: request.headers }),
  });
}

const authMiddlewareRaw: FastifyPluginCallback<{ db: Database.Database }> = (
  app,
  options,
  done
) => {
  const stmt = options.db.prepare(
    "SELECT id, name, allowed_models FROM router_keys WHERE key_hash = ? AND is_active = 1"
  );

  app.addHook("onRequest", async (request, reply) => {
    if (shouldSkipAuth(request.url)) {
      return;
    }

    const proxyApiType = getProxyApiType(request.url);

    // 代理请求一到达就记录技术日志
    if (proxyApiType) {
      request.log.info(
        { method: request.method, url: request.url, ip: request.ip },
        `Proxy request received [${proxyApiType}]`,
      );
    }

    // 未初始化时代理层不可用
    if (!isInitialized(options.db)) {
      if (proxyApiType) {
        logRejectedAuth(options.db, proxyApiType, HTTP_SERVICE_UNAVAILABLE, "Service not initialized", request);
      }
      reply.code(HTTP_SERVICE_UNAVAILABLE).send({ error: { message: "Service not initialized" } });
      return reply;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      if (proxyApiType) {
        logRejectedAuth(options.db, proxyApiType, HTTP_UNAUTHORIZED, "Invalid API key", request);
      }
      unauthorizedReply(reply);
      return reply;
    }

    const token = authHeader.slice(BEARER_PREFIX_LENGTH);
    const hash = createHash("sha256").update(token).digest("hex");
    const row = stmt.get(hash) as RouterKeyRow | undefined;
    if (!row) {
      if (proxyApiType) {
        logRejectedAuth(options.db, proxyApiType, HTTP_UNAUTHORIZED, "Invalid API key", request);
      }
      unauthorizedReply(reply);
      return reply;
    }

    request.routerKey = { id: row.id, name: row.name, allowed_models: row.allowed_models };
  });

  done();
};

export const authMiddleware = fp(authMiddlewareRaw, { name: "auth-middleware" });
