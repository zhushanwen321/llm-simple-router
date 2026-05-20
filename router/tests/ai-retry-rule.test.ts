import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import {
  initDatabase,
  createProvider,
  insertRequestLog,
  updateLogStreamContent,
  createRetryRule,
} from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/mock-backend.js";

// ---------- helpers ----------

function createMockLLMServer(
  response: Record<string, unknown>,
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function closeMockServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

const encryptedApiKey = encrypt("test-api-key", TEST_ENCRYPTION_KEY);

// ---------- tests ----------

describe("AI Retry Rule", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  // ===== Config Extension =====

  it("GET proxy-enhancement returns ai_retry_config as null when not configured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty("ai_retry_config");
    expect(body.data.ai_retry_config).toBeNull();
  });

  it("PUT proxy-enhancement with ai_retry_config saves and GET returns it", async () => {
    const payload = {
      tool_call_loop_enabled: false,
      stream_loop_enabled: false,
      tool_round_limit_enabled: true,
      tool_error_logging_enabled: false,
      ai_retry_config: {
        provider_id: "test-ai-provider",
        model: "test-ai-model",
      },
    };

    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie, "content-type": "application/json" },
      payload,
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.data.ai_retry_config).toEqual({
      provider_id: "test-ai-provider",
      model: "test-ai-model",
    });
  });

  it("PUT proxy-enhancement without ai_retry_config doesn't affect existing fields", async () => {
    // First save with ai_retry_config
    const put1Res = await app.inject({
      method: "PUT",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        tool_call_loop_enabled: false,
        stream_loop_enabled: false,
        tool_round_limit_enabled: true,
        tool_error_logging_enabled: false,
        ai_retry_config: { provider_id: "p", model: "m" },
      },
    });
    expect(put1Res.statusCode).toBe(200);

    // Then PUT without ai_retry_config — existing fields should update,
    // but ai_retry_config should remain unchanged
    const put2Res = await app.inject({
      method: "PUT",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        tool_call_loop_enabled: true,
        stream_loop_enabled: false,
        tool_round_limit_enabled: true,
        tool_error_logging_enabled: false,
      },
    });
    expect(put2Res.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.data.tool_call_loop_enabled).toBe(true);
    expect(body.data.ai_retry_config).toEqual({ provider_id: "p", model: "m" });
  });

  // ===== AI Generate =====

  it("POST ai-generate returns error when AI config not set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      headers: { cookie, "content-type": "application/json" },
      payload: { log_id: "test-log-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.success).toBe(false);
    expect(body.data).toHaveProperty("error");
    expect(typeof body.data.error).toBe("string");
  });

  it("POST ai-generate returns error when log not found", async () => {
    // Set AI config first
    await app.inject({
      method: "PUT",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        tool_call_loop_enabled: false,
        stream_loop_enabled: false,
        tool_round_limit_enabled: true,
        tool_error_logging_enabled: false,
        ai_retry_config: { provider_id: "test-provider", model: "test-model" },
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      headers: { cookie, "content-type": "application/json" },
      payload: { log_id: "non-existent-log" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.success).toBe(false);
    expect(body.data).toHaveProperty("error");
  });

  it("POST ai-generate returns error for 2xx success response", async () => {
    const mockLLM = await createMockLLMServer({
      choices: [{ message: { content: "test" } }],
    });

    try {
      const providerId = createProvider(db, {
        name: "Test AI Provider",
        api_type: "openai",
        base_url: `http://127.0.0.1:${mockLLM.port}`,
        upstream_path: "/v1/chat/completions",
        api_key: encryptedApiKey,
        is_active: 1,
        max_concurrency: 10,
        queue_timeout_ms: 30000,
        max_queue_size: 100,
      });

      await app.inject({
        method: "PUT",
        url: "/admin/api/proxy-enhancement",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          tool_call_loop_enabled: false,
          stream_loop_enabled: false,
          tool_round_limit_enabled: true,
          tool_error_logging_enabled: false,
          ai_retry_config: { provider_id: providerId, model: "test-model" },
        },
      });

      // Insert a log with 200 status — this should be rejected
      insertRequestLog(db, {
        id: "success-log",
        api_type: "openai",
        model: "test-model",
        provider_id: providerId,
        status_code: 200,
        latency_ms: 100,
        is_stream: 0,
        error_message: null,
        created_at: new Date().toISOString(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/admin/api/retry-rules/ai-generate",
        headers: { cookie, "content-type": "application/json" },
        payload: { log_id: "success-log" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data).toHaveProperty("error");
    } finally {
      await closeMockServer(mockLLM.server);
    }
  });

  it("POST ai-generate returns success with rule from LLM", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "检测到 503 server_error (overloaded)",
              name: "Test Provider 503 过载重试",
              status_code: 503,
              body_pattern: "overloaded|server_error",
              retry_strategy: "exponential",
              retry_delay_ms: 2000,
              max_retries: 5,
              max_delay_ms: 60000,
            }),
          },
        },
      ],
    };

    const mockLLM = await createMockLLMServer(mockResponse);

    try {
      const providerId = createProvider(db, {
        name: "Test AI Provider",
        api_type: "openai",
        base_url: `http://127.0.0.1:${mockLLM.port}`,
        upstream_path: "/v1/chat/completions",
        api_key: encryptedApiKey,
        is_active: 1,
        max_concurrency: 10,
        queue_timeout_ms: 30000,
        max_queue_size: 100,
      });

      await app.inject({
        method: "PUT",
        url: "/admin/api/proxy-enhancement",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          tool_call_loop_enabled: false,
          stream_loop_enabled: false,
          tool_round_limit_enabled: true,
          tool_error_logging_enabled: false,
          ai_retry_config: { provider_id: providerId, model: "test-model" },
        },
      });

      insertRequestLog(db, {
        id: "error-log-503",
        api_type: "openai",
        model: "test-model",
        provider_id: providerId,
        status_code: 503,
        client_status_code: 503,
        latency_ms: 32,
        is_stream: 0,
        error_message: "The server is temporarily overloaded.",
        upstream_response: JSON.stringify({
          error: { message: "overloaded", type: "server_error" },
        }),
        created_at: new Date().toISOString(),
        is_retry: 0,
        is_failover: 0,
      });

      const res = await app.inject({
        method: "POST",
        url: "/admin/api/retry-rules/ai-generate",
        headers: { cookie, "content-type": "application/json" },
        payload: { log_id: "error-log-503" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.rule).toBeDefined();
      expect(body.data.rule.name).toBe("Test Provider 503 过载重试");
      expect(body.data.rule.status_code).toBe(503);
      expect(body.data.rule.body_pattern).toBe("overloaded|server_error");
      expect(body.data.rule.retry_strategy).toBe("exponential");
      expect(body.data.summary).toBe("检测到 503 server_error (overloaded)");
    } finally {
      await closeMockServer(mockLLM.server);
    }
  });

  it("POST ai-generate returns error when AI returns error exit", async () => {
    // Mock LLM returns a non-JSON error description
    const mockResponse = {
      choices: [
        {
          message: {
            content: "error: unable to analyze the log context",
          },
        },
      ],
    };

    const mockLLM = await createMockLLMServer(mockResponse);

    try {
      const providerId = createProvider(db, {
        name: "Test AI Provider",
        api_type: "openai",
        base_url: `http://127.0.0.1:${mockLLM.port}`,
        upstream_path: "/v1/chat/completions",
        api_key: encryptedApiKey,
        is_active: 1,
        max_concurrency: 10,
        queue_timeout_ms: 30000,
        max_queue_size: 100,
      });

      await app.inject({
        method: "PUT",
        url: "/admin/api/proxy-enhancement",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          tool_call_loop_enabled: false,
          stream_loop_enabled: false,
          tool_round_limit_enabled: true,
          tool_error_logging_enabled: false,
          ai_retry_config: { provider_id: providerId, model: "test-model" },
        },
      });

      insertRequestLog(db, {
        id: "error-log-503-b",
        api_type: "openai",
        model: "test-model",
        provider_id: providerId,
        status_code: 503,
        latency_ms: 32,
        is_stream: 0,
        error_message: "overloaded",
        created_at: new Date().toISOString(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/admin/api/retry-rules/ai-generate",
        headers: { cookie, "content-type": "application/json" },
        payload: { log_id: "error-log-503-b" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data).toHaveProperty("error");
    } finally {
      await closeMockServer(mockLLM.server);
    }
  });

  it("POST ai-generate validates required fields (summary, name)", async () => {
    // Mock returns JSON but missing required fields
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "test summary",
            }),
          },
        },
      ],
    };

    const mockLLM = await createMockLLMServer(mockResponse);

    try {
      const providerId = createProvider(db, {
        name: "Test AI Provider",
        api_type: "openai",
        base_url: `http://127.0.0.1:${mockLLM.port}`,
        upstream_path: "/v1/chat/completions",
        api_key: encryptedApiKey,
        is_active: 1,
        max_concurrency: 10,
        queue_timeout_ms: 30000,
        max_queue_size: 100,
      });

      await app.inject({
        method: "PUT",
        url: "/admin/api/proxy-enhancement",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          tool_call_loop_enabled: false,
          stream_loop_enabled: false,
          tool_round_limit_enabled: true,
          tool_error_logging_enabled: false,
          ai_retry_config: { provider_id: providerId, model: "test-model" },
        },
      });

      insertRequestLog(db, {
        id: "error-log-503-c",
        api_type: "openai",
        model: "test-model",
        provider_id: providerId,
        status_code: 503,
        latency_ms: 32,
        is_stream: 0,
        error_message: "overloaded",
        created_at: new Date().toISOString(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/admin/api/retry-rules/ai-generate",
        headers: { cookie, "content-type": "application/json" },
        payload: { log_id: "error-log-503-c" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data).toHaveProperty("error");
    } finally {
      await closeMockServer(mockLLM.server);
    }
  });

  it("POST ai-generate uses stream_text_content fallback", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "Detected error from stream content",
              name: "Stream Error Retry",
              status_code: 503,
              body_pattern: "timeout",
              retry_strategy: "fixed",
              retry_delay_ms: 1000,
              max_retries: 3,
              max_delay_ms: 10000,
            }),
          },
        },
      ],
    };

    const mockLLM = await createMockLLMServer(mockResponse);

    try {
      const providerId = createProvider(db, {
        name: "Test AI Provider",
        api_type: "openai",
        base_url: `http://127.0.0.1:${mockLLM.port}`,
        upstream_path: "/v1/chat/completions",
        api_key: encryptedApiKey,
        is_active: 1,
        max_concurrency: 10,
        queue_timeout_ms: 30000,
        max_queue_size: 100,
      });

      await app.inject({
        method: "PUT",
        url: "/admin/api/proxy-enhancement",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          tool_call_loop_enabled: false,
          stream_loop_enabled: false,
          tool_round_limit_enabled: true,
          tool_error_logging_enabled: false,
          ai_retry_config: { provider_id: providerId, model: "test-model" },
        },
      });

      // Insert a log with null error_message (stream response)
      insertRequestLog(db, {
        id: "stream-error-log",
        api_type: "openai",
        model: "test-model",
        provider_id: providerId,
        status_code: 503,
        latency_ms: 200,
        is_stream: 1,
        error_message: null,
        created_at: new Date().toISOString(),
      });

      // Set stream_text_content as fallback error context
      updateLogStreamContent(db, "stream-error-log", "stream timeout occurred after 30s");

      const res = await app.inject({
        method: "POST",
        url: "/admin/api/retry-rules/ai-generate",
        headers: { cookie, "content-type": "application/json" },
        payload: { log_id: "stream-error-log" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
    } finally {
      await closeMockServer(mockLLM.server);
    }
  });

  it("POST ai-generate returns error when provider not found", async () => {
    // Set AI config pointing to a non-existent provider
    await app.inject({
      method: "PUT",
      url: "/admin/api/proxy-enhancement",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        tool_call_loop_enabled: false,
        stream_loop_enabled: false,
        tool_round_limit_enabled: true,
        tool_error_logging_enabled: false,
        ai_retry_config: {
          provider_id: "non-existent-provider",
          model: "test-model",
        },
      },
    });

    insertRequestLog(db, {
      id: "error-log-no-provider",
      api_type: "openai",
      model: "test-model",
      provider_id: "non-existent-provider",
      status_code: 503,
      latency_ms: 32,
      is_stream: 0,
      error_message: "overloaded",
      created_at: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      headers: { cookie, "content-type": "application/json" },
      payload: { log_id: "error-log-no-provider" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.success).toBe(false);
    expect(body.data).toHaveProperty("error");
  });
});
