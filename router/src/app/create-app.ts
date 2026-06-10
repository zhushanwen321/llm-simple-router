import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { insertRequestLog } from "../db/logs.js";
import { HTTP_INTERNAL_ERROR, getProxyApiType } from "../core/constants.js";
import { loadRecommendedConfig } from "../config/recommended.js";
import { startUpgradeChecker } from "../admin/upgrade.js";
import type { CheckerOptions } from "../upgrade/checker.js";
import { isAdminApiResponse, statusToApiCode, apiError } from "../admin/api-response.js";
import { API_CODE, type ApiResponse } from "../admin/api-response.js";
import type { Config } from "../config/index.js";
import type Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KB = 1024;
const MB = KB * KB;
const MAX_BODY_SIZE_MB = 50;

export interface CreateAppOptions {
  config: Config;
  db: Database.Database;
  upgradeCheckerOptions?: CheckerOptions;
}

/**
 * 创建 Fastify 实例并注册全局 hooks（errorHandler、onSend 信封包装等）。
 * 纯基础设施层，不涉及业务容器或路由。
 */
export function createAppInstance(opts: CreateAppOptions): FastifyInstance {
  const { config, db, upgradeCheckerOptions } = opts;
  const isDev = process.env.NODE_ENV !== "production";

  const app = Fastify({
    bodyLimit: MAX_BODY_SIZE_MB * MB,
    logger: {
      level: config.LOG_LEVEL,
      ...(isDev
        ? {
          transport: {
            target: "pino-pretty",
            options: {
              translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
        }
        : {}),
    },
    ajv: {
      customOptions: {
        messages: true,
      },
    },
  });

  app.setSchemaErrorFormatter((errors) => {
    const message = errors
      .map((e) => {
        const field = e.instancePath ? e.instancePath.slice(1) : e.params?.missingProperty ?? "field";
        return `${field} ${e.message}`;
      })
      .join("; ");
    return new Error(message);
  });

  // 记录请求到达时间，供全局错误处理计算延迟
  app.addHook("onRequest", (request, reply, done) => {
    (request as unknown as { receivedAt: number }).receivedAt = Date.now();

    // 全局 EPIPE 防护
    const sock = request.raw.socket;
    const socketErrorHandler = (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE" || err.code === "ECONNRESET") {
        request.log.debug({ err }, "client socket error");
      } else {
        request.log.warn({ err }, "unexpected socket error");
      }
    };
    sock.on("error", socketErrorHandler);

    const replyErrorHandler = (err: Error) => {
      const code = (err as { code?: string }).code;
      if (code === "EPIPE") {
        request.log.debug({ err }, "client disconnected (EPIPE)");
      } else {
        request.log.warn({ err }, "response stream error");
      }
    };
    reply.raw.on("error", replyErrorHandler);

    reply.raw.on("close", () => {
      sock.removeListener("error", socketErrorHandler);
      reply.raw.removeListener("error", replyErrorHandler);
    });

    done();
  });

  // 统一错误处理
  app.setErrorHandler((error: Error, request, reply) => {
    const fastifyError = error as Error & { statusCode?: number; validation?: unknown[] };
    const status = fastifyError.statusCode ?? HTTP_INTERNAL_ERROR;

    if (!isAdminApiResponse(request.url)) {
      const proxyApiType = getProxyApiType(request.url);
      if (proxyApiType) {
        request.log.error({ statusCode: status, err: error }, `Proxy request error: ${fastifyError.message}`);
        const body = request.body as Record<string, unknown> | undefined;
        const receivedAt = (request as unknown as { receivedAt?: number }).receivedAt;
        const latencyMs = receivedAt ? Date.now() - receivedAt : 0;
        try {
          insertRequestLog(db, {
            id: randomUUID(),
            api_type: proxyApiType,
            model: (body?.model as string) || null,
            provider_id: null,
            status_code: status,
            latency_ms: latencyMs,
            is_stream: body?.stream === true ? 1 : 0,
            error_message: fastifyError.message,
            created_at: new Date().toISOString(),
            client_request: JSON.stringify({ headers: request.headers, ...(body ? { body } : {}) }),
            router_key_id: request.routerKey?.id ?? null,
          });
        } catch (logErr) {
          request.log.error({ err: logErr }, "Failed to log proxy error to request_logs");
        }
      }
      return reply.code(status).send({ error: { message: fastifyError.message } });
    }

    const code = statusToApiCode(status);
    return reply.code(status).send(apiError(code, fastifyError.message));
  });

  // onSend hook：自动包装 Admin API 成功响应为信封格式
  app.addHook("onSend", async (request, reply, payload) => {
    if (!isAdminApiResponse(request.url, reply.getHeader("content-type") as string | undefined)) {
      return payload;
    }

    if (typeof payload === "string") {
      try {
        const parsed = JSON.parse(payload);
        if (parsed !== null && typeof parsed === "object" && "code" in parsed) return payload;
        const wrapped: ApiResponse<unknown> = {
          code: API_CODE.SUCCESS,
          message: "ok",
          data: parsed,
        };
        return JSON.stringify(wrapped);
      } catch {
        return payload;
      }
    }

    return payload;
  });

  loadRecommendedConfig(path.resolve(__dirname, "../../config"));
  startUpgradeChecker({
    ...upgradeCheckerOptions,
    configDir: path.resolve(__dirname, "../../config"),
  });

  return app;
}
