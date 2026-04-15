import { FastifyPluginCallback } from "fastify";
import { request as httpRequestParam, IncomingMessage } from "http";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import {
  getActiveBackendServices,
  getModelMapping,
  insertRequestLog,
  BackendService,
} from "../db/index.js";
import { decrypt } from "../utils/crypto.js";

// ---------- 类型声明 ----------

export interface OpenaiProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
}

// ---------- Header 透传工具 ----------

const SKIP_UPSTREAM = new Set([
  "host",
  "content-length",
  "accept-encoding",
  "authorization", // OpenAI 用 Bearer token，替换为后端 key
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function selectHeaders(
  raw: Record<string, string | string[] | undefined>,
  skip: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || skip.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

// ---------- 错误响应工具 ----------

function openaiError(
  message: string,
  type: string,
  code: string,
  statusCode: number
) {
  return {
    statusCode,
    body: {
      error: { message, type, code },
    },
  };
}

// ---------- 非流式代理 ----------

function proxyNonStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: Record<string, string | string[] | undefined>
): Promise<{
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  sentHeaders: Record<string, string>;
  sentBody: string;
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/chat/completions`);
    const payload = JSON.stringify(body);

    const fwd = selectHeaders(clientHeaders, SKIP_UPSTREAM);
    fwd["Authorization"] = `Bearer ${apiKey}`;
    fwd["Content-Type"] = "application/json";
    fwd["Content-Length"] = String(Buffer.byteLength(payload));

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: fwd,
    };

    const req = httpRequestParam(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 502,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: selectHeaders(
            res.headers as Record<string, string | string[] | undefined>,
            SKIP_DOWNSTREAM
          ),
          sentHeaders: { ...fwd },
          sentBody: payload,
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// ---------- 流式代理（SSE） ----------

function proxyStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: Record<string, string | string[] | undefined>,
  reply: any,
  timeoutMs: number
): Promise<{ statusCode: number; responseBody?: string; upstreamResponseHeaders?: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/chat/completions`);
    const payload = JSON.stringify(body);

    const fwd = selectHeaders(clientHeaders, SKIP_UPSTREAM);
    fwd["Authorization"] = `Bearer ${apiKey}`;
    fwd["Content-Type"] = "application/json";
    fwd["Content-Length"] = String(Buffer.byteLength(payload));

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: fwd,
    };

    const upstreamReq = httpRequestParam(
      options,
      (upstreamRes: IncomingMessage) => {
        const statusCode = upstreamRes.statusCode || 502;

        if (statusCode !== 200) {
          const chunks: Buffer[] = [];
          upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on("end", () => {
            const errorBody = Buffer.concat(chunks).toString("utf-8");
            const errHeaders = selectHeaders(
              upstreamRes.headers as Record<
                string,
                string | string[] | undefined
              >,
              SKIP_DOWNSTREAM
            );
            resolve({ statusCode, responseBody: errorBody, upstreamResponseHeaders: errHeaders });
            for (const [key, value] of Object.entries(errHeaders)) {
              reply.header(key, value);
            }
            reply.status(statusCode).send(errorBody);
          });
          return;
        }

        // 合并上游 header + SSE 必要 header
        const sseHeaders = selectHeaders(
          upstreamRes.headers as Record<
            string,
            string | string[] | undefined
          >,
          SKIP_DOWNSTREAM
        );
        sseHeaders["Content-Type"] = "text/event-stream";
        sseHeaders["Cache-Control"] = "no-cache";
        sseHeaders["Connection"] = "keep-alive";
        reply.raw.writeHead(statusCode, sseHeaders);

        const passThrough = new PassThrough();
        passThrough.pipe(reply.raw);

        const captureChunks: Buffer[] = [];
        let idleTimer: NodeJS.Timeout | null = null;
        let resolved = false;

        function cleanup() {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = null;
          try {
            passThrough.destroy();
          } catch {
            /* already destroyed */
          }
          try {
            upstreamRes.destroy();
          } catch {
            /* already destroyed */
          }
        }

        // 客户端断开时清理资源，防止 EPIPE 崩溃
        reply.raw.on("close", () => {
          if (!resolved) {
            cleanup();
            resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders });
          }
        });

        // 防止 pipe 回传的 socket 错误导致未捕获异常
        passThrough.on("error", () => {
          cleanup();
          if (!resolved) {
            resolved = true;
            resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders });
          }
        });

        function resetIdleTimer() {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            cleanup();
            if (!resolved) {
              resolved = true;
              resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders });
            }
          }, timeoutMs);
        }

        resetIdleTimer();

        upstreamRes.on("data", (chunk: Buffer) => {
          if (resolved) return;
          resetIdleTimer();
          passThrough.write(chunk);
          captureChunks.push(chunk);
        });

        // 后端自行发送 [DONE]，这里只做清理
        upstreamRes.on("end", () => {
          if (resolved) return;
          resolved = true;
          if (idleTimer) clearTimeout(idleTimer);
          passThrough.end();
          reply.raw.end();
          const responseBody = Buffer.concat(captureChunks).toString("utf-8");
          resolve({ statusCode, responseBody, upstreamResponseHeaders: sseHeaders });
        });

        upstreamRes.on("error", (err) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          reject(err);
        });
      }
    );

    upstreamReq.on("error", (err) => reject(err));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

// ---------- /v1/models 代理 ----------

function proxyModelsRequest(
  backend: BackendService,
  apiKey: string,
  clientHeaders: Record<string, string | string[] | undefined>
): Promise<{
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/models`);

    const fwd = selectHeaders(clientHeaders, SKIP_UPSTREAM);
    fwd["Authorization"] = `Bearer ${apiKey}`;

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "GET",
      headers: fwd,
    };

    const req = httpRequestParam(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 502,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: selectHeaders(
            res.headers as Record<string, string | string[] | undefined>,
            SKIP_DOWNSTREAM
          ),
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.end();
  });
}

// ---------- Fastify 插件 ----------

const openaiProxyRaw: FastifyPluginCallback<OpenaiProxyOptions> = (
  app,
  options,
  done
) => {
  const { db, encryptionKey, streamTimeoutMs } = options;

  app.post("/v1/chat/completions", async (request, reply) => {
    // 客户端断开后 socket 写入会触发 EPIPE，必须监听否则进程崩溃
    request.raw.socket.on("error", () => {});

    const startTime = Date.now();
    const logId = randomUUID();

    // 1. 查找后端服务
    const backends = getActiveBackendServices(db, "openai");
    if (backends.length === 0) {
      const err = openaiError(
        "No active OpenAI backend service found",
        "invalid_request_error",
        "model_not_found",
        404
      );
      return reply.status(err.statusCode).send(err.body);
    }
    const backend = backends[0];

    // 2. 提取请求 body，保存客户端原始请求
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));
    const clientModel = (body.model as string) || "unknown";

    // 3. 模型映射
    const mapping = getModelMapping(db, clientModel);
    if (mapping) {
      body.model = mapping.backend_model;
    }

    // 4. 解密 API Key
    const apiKey = decrypt(backend.api_key, encryptionKey);

    const isStream = body.stream === true;
    const requestBodyStr = JSON.stringify(body);
    const clientHeaders = request.headers as Record<
      string,
      string | string[] | undefined
    >;

    // 5. 构建日志数据
    const upstreamReqHeaders = selectHeaders(clientHeaders, SKIP_UPSTREAM);
    upstreamReqHeaders["Authorization"] = `Bearer ${apiKey}`;
    upstreamReqHeaders["Content-Type"] = "application/json";
    upstreamReqHeaders["Content-Length"] = String(Buffer.byteLength(requestBodyStr));
    const clientRequest = JSON.stringify({ headers: clientHeaders, body: originalBody });
    const upstreamRequest = JSON.stringify({ url: `${backend.base_url}/v1/chat/completions`, headers: upstreamReqHeaders, body: requestBodyStr });

    try {
      if (isStream) {
        const result = await proxyStream(
          backend,
          apiKey,
          body,
          clientHeaders,
          reply,
          streamTimeoutMs
        );

        insertRequestLog(db, {
          id: logId,
          api_type: "openai",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 1,
          error_message: null,
          created_at: new Date().toISOString(),
          request_body: requestBodyStr,
          response_body: result.responseBody ?? null,
          client_request: clientRequest,
          upstream_request: upstreamRequest,
          upstream_response: JSON.stringify({ statusCode: result.statusCode, headers: result.upstreamResponseHeaders ?? {}, body: result.responseBody }),
          client_response: JSON.stringify({ statusCode: result.statusCode, headers: result.upstreamResponseHeaders ?? {}, body: result.responseBody }),
        });

        return reply;
      } else {
        const result = await proxyNonStream(
          backend,
          apiKey,
          body,
          clientHeaders
        );

        insertRequestLog(db, {
          id: logId,
          api_type: "openai",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 0,
          error_message: null,
          created_at: new Date().toISOString(),
          request_body: requestBodyStr,
          response_body: result.body,
          client_request: clientRequest,
          upstream_request: upstreamRequest,
          upstream_response: JSON.stringify({ statusCode: result.statusCode, headers: result.sentHeaders, body: result.body }),
          client_response: JSON.stringify({ statusCode: result.statusCode, headers: result.headers, body: result.body }),
        });

        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
        return reply.status(result.statusCode).send(result.body);
      }
    } catch (err: any) {
      insertRequestLog(db, {
        id: logId,
        api_type: "openai",
        model: clientModel,
        backend_service_id: backend.id,
        status_code: 502,
        latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0,
        error_message: err.message || "Upstream connection failed",
        created_at: new Date().toISOString(),
        request_body: requestBodyStr,
        client_request: clientRequest,
        upstream_request: upstreamRequest,
      });

      const errorResp = openaiError(
        "Failed to connect to upstream service",
        "upstream_error",
        "upstream_connection_failed",
        502
      );
      return reply.status(502).send(errorResp.body);
    }
  });

  // GET /v1/models - 透传到 OpenAI 后端的模型列表
  app.get("/v1/models", async (request, reply) => {
    const backends = getActiveBackendServices(db, "openai");
    if (backends.length === 0) {
      return reply.status(404).send({
        error: {
          message: "No active OpenAI backend service configured",
          type: "invalid_request_error",
          code: "no_backend",
        },
      });
    }

    const backend = backends[0];
    const apiKey = decrypt(backend.api_key, encryptionKey);
    const clientHeaders = request.headers as Record<
      string,
      string | string[] | undefined
    >;

    try {
      const result = await proxyModelsRequest(backend, apiKey, clientHeaders);
      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }
      return reply.status(result.statusCode).send(result.body);
    } catch (err: any) {
      request.log.error(
        { err },
        "Failed to reach OpenAI backend for /v1/models"
      );
      return reply.status(502).send({
        error: {
          message: "Failed to reach backend service",
          type: "server_error",
          code: "upstream_error",
        },
      });
    }
  });

  done();
};

// 用 fp 包装使 hook 作用于全局
export const openaiProxy = fp(openaiProxyRaw, { name: "openai-proxy" });
