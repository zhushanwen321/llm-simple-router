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

export interface AnthropicProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
}

// ---------- 错误响应工具（Anthropic 格式） ----------

function anthropicError(message: string, type: string, statusCode: number) {
  return {
    statusCode,
    body: {
      type: "error",
      error: { type, message },
    },
  };
}

// ---------- 非流式代理 ----------

function proxyNonStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/messages`);
    const payload = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = httpRequestParam(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 502,
          body: Buffer.concat(chunks).toString("utf-8"),
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
  reply: any,
  timeoutMs: number
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/messages`);
    const payload = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const upstreamReq = httpRequestParam(
      options,
      (upstreamRes: IncomingMessage) => {
        const statusCode = upstreamRes.statusCode || 502;

        if (statusCode !== 200) {
          const chunks: Buffer[] = [];
          upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on("end", () => {
            resolve({ statusCode });
            reply.status(statusCode).send(Buffer.concat(chunks));
          });
          return;
        }

        // SSE 透传
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const passThrough = new PassThrough();
        passThrough.pipe(reply.raw);

        let idleTimer: NodeJS.Timeout | null = null;

        function resetIdleTimer() {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            passThrough.end();
            reply.raw.end();
          }, timeoutMs);
        }

        resetIdleTimer();

        upstreamRes.on("data", (chunk: Buffer) => {
          resetIdleTimer();
          passThrough.write(chunk);
        });

        // Anthropic SSE 无 [DONE]，后端用 message_stop 结束，这里只做清理
        upstreamRes.on("end", () => {
          if (idleTimer) clearTimeout(idleTimer);
          passThrough.end();
          reply.raw.end();
          resolve({ statusCode });
        });

        upstreamRes.on("error", (err) => {
          if (idleTimer) clearTimeout(idleTimer);
          passThrough.destroy(err);
          reject(err);
        });
      }
    );

    upstreamReq.on("error", (err) => reject(err));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

// ---------- Fastify 插件 ----------

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (
  app,
  options,
  done
) => {
  const { db, encryptionKey, streamTimeoutMs } = options;

  app.post("/v1/messages", async (request, reply) => {
    const startTime = Date.now();
    const logId = randomUUID();

    // 1. 查找后端服务
    const backends = getActiveBackendServices(db, "anthropic");
    if (backends.length === 0) {
      const err = anthropicError(
        "No active Anthropic backend service found",
        "invalid_request_error",
        404
      );
      return reply.status(err.statusCode).send(err.body);
    }
    const backend = backends[0];

    // 2. 提取请求 body 中的 model
    const body = request.body as Record<string, unknown>;
    const clientModel = (body.model as string) || "unknown";

    // 3. 模型映射
    const mapping = getModelMapping(db, clientModel);
    if (mapping) {
      body.model = mapping.backend_model;
    }

    // 4. 解密 API Key
    const apiKey = decrypt(backend.api_key, encryptionKey);

    const isStream = body.stream === true;

    try {
      if (isStream) {
        const result = await proxyStream(
          backend,
          apiKey,
          body,
          reply,
          streamTimeoutMs
        );

        insertRequestLog(db, {
          id: logId,
          api_type: "anthropic",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 1,
          error_message: null,
          created_at: new Date().toISOString(),
        });

        return reply;
      } else {
        const result = await proxyNonStream(backend, apiKey, body);

        insertRequestLog(db, {
          id: logId,
          api_type: "anthropic",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 0,
          error_message: null,
          created_at: new Date().toISOString(),
        });

        return reply.status(result.statusCode).send(result.body);
      }
    } catch (err: any) {
      insertRequestLog(db, {
        id: logId,
        api_type: "anthropic",
        model: clientModel,
        backend_service_id: backend.id,
        status_code: 502,
        latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0,
        error_message: err.message || "Upstream connection failed",
        created_at: new Date().toISOString(),
      });

      const errorResp = anthropicError(
        "Failed to connect to upstream service",
        "upstream_error",
        502
      );
      return reply.status(502).send(errorResp.body);
    }
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, {
  name: "anthropic-proxy",
});
