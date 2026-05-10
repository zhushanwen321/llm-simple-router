import { FastifyPluginCallback, FastifyReply } from "fastify";
import { createHash } from "crypto";
import fp from "fastify-plugin";
import Database from "better-sqlite3";
import { isInitialized } from "../db/settings.js";
import { getProxyApiType, HTTP_SERVICE_UNAVAILABLE } from "../core/constants.js";

declare module "fastify" {
  interface FastifyRequest {
    // allowed_models 是 JSON 字符串，需 JSON.parse
    routerKey?: { id: string; name: string; allowed_models: string | null };
  }
}

interface RouterKeyRow { id: string; name: string; allowed_models: string | null; }

const SKIP_PATHS = ["/health", "/admin"];
const HTTP_UNAUTHORIZED = 401;
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
        request.log.info({ method: request.method, url: request.url, ip: request.ip }, `Rejected: service not initialized [${proxyApiType}]`);
      }
      reply.code(HTTP_SERVICE_UNAVAILABLE).send({ error: { message: "Service not initialized" } });
      return reply;
    }

    let token: string | undefined;
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(BEARER_PREFIX_LENGTH);
    } else {
      // Fallback: Anthropic SDK sends API key via x-api-key header
      const apiKeyHeader = request.headers["x-api-key"] as string | undefined;
      if (apiKeyHeader) {
        token = apiKeyHeader;
      }
    }

    if (!token) {
      if (proxyApiType) {
        request.log.info({ method: request.method, url: request.url, ip: request.ip }, `Rejected: no API key [${proxyApiType}]`);
      }
      unauthorizedReply(reply);
      return reply;
    }
    const hash = createHash("sha256").update(token).digest("hex");
    const row = stmt.get(hash) as RouterKeyRow | undefined;
    if (!row) {
      if (proxyApiType) {
        request.log.info({ method: request.method, url: request.url, ip: request.ip }, `Rejected: invalid API key [${proxyApiType}]`);
      }
      unauthorizedReply(reply);
      return reply;
    }

    request.routerKey = { id: row.id, name: row.name, allowed_models: row.allowed_models };
  });

  done();
};

export const authMiddleware = fp(authMiddlewareRaw, { name: "auth-middleware" });
