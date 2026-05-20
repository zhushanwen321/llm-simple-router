import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import https from "https";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createMockBackend } from "./helpers/mock-backend.js";
import { callLLM } from "../src/utils/llm-client.js";

// ---------- Shared helpers ----------

function closeServer(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function generateSelfSignedCert(): { key: string; cert: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "llm-client-https-"));
  const keyPath = join(tmpDir, "key.pem");
  const certPath = join(tmpDir, "cert.pem");

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=127.0.0.1"`,
    { stdio: "pipe" },
  );

  const key = readFileSync(keyPath, "utf-8");
  const cert = readFileSync(certPath, "utf-8");

  rmSync(tmpDir, { recursive: true, force: true });

  return { key, cert };
}

// ---------- Valid response body shared across success tests ----------

const VALID_RESPONSE = JSON.stringify({
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
});

// =================== SUCCESSFUL REQUEST / RESPONSE ===================

describe("callLLM", () => {
  describe("successful request and response", () => {
    let backend: Awaited<ReturnType<typeof createMockBackend>>;
    const captured: {
      method: string;
      url: string;
      authHeader: string;
      contentTypeHeader: string;
      body: Record<string, unknown>;
    } = {
      method: "",
      url: "",
      authHeader: "",
      contentTypeHeader: "",
      body: {},
    };

    beforeAll(async () => {
      backend = await createMockBackend((req, res) => {
        captured.method = req.method ?? "";
        captured.url = req.url ?? "";
        captured.authHeader = (req.headers["authorization"] as string) ?? "";
        captured.contentTypeHeader =
          (req.headers["content-type"] as string) ?? "";

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf-8");
        });
        req.on("end", () => {
          captured.body = JSON.parse(body) as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(VALID_RESPONSE);
        });
      });
    });

    afterAll(async () => {
      await backend.close();
    });

    // --- Test 1: correct request format ---

    it("sends POST request with correct headers and body format", async () => {
      await callLLM({
        baseUrl: `http://127.0.0.1:${backend.port}`,
        upstreamPath: "/v1/chat/completions",
        apiKey: "test-key-123",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 100,
      });

      expect(captured.method).toBe("POST");
      expect(captured.authHeader).toBe("Bearer test-key-123");
      expect(captured.contentTypeHeader).toBe("application/json");
      expect(captured.body.model).toBe("gpt-4");
      expect(captured.body.messages).toEqual([
        { role: "user", content: "Hi" },
      ]);
      expect(captured.body.max_tokens).toBe(100);
      expect(captured.body.stream).toBe(false);
    });

    // --- Test 2: extract content ---

    it("extracts content from successful response", async () => {
      const result = await callLLM({
        baseUrl: `http://127.0.0.1:${backend.port}`,
        upstreamPath: "/v1/chat/completions",
        apiKey: "test-key",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.content).toBe("Hello!");
    });
  });

  // =================== DEFAULT UPSTREAM PATH ===================

  describe("default upstreamPath", () => {
    let backend: Awaited<ReturnType<typeof createMockBackend>>;
    let capturedUrl = "";

    beforeAll(async () => {
      backend = await createMockBackend((req, res) => {
        capturedUrl = req.url ?? "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(VALID_RESPONSE);
      });
    });

    afterAll(async () => {
      await backend.close();
    });

    // --- Test 6: null upstreamPath uses default ---

    it("uses default /v1/chat/completions when upstreamPath is null", async () => {
      await callLLM({
        baseUrl: `http://127.0.0.1:${backend.port}`,
        upstreamPath: null,
        apiKey: "test-key",
        model: "gpt-4",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(capturedUrl).toBe("/v1/chat/completions");
    });
  });

  // =================== MAX TOKENS ===================

  describe("maxTokens option", () => {
    let backend: Awaited<ReturnType<typeof createMockBackend>>;
    let capturedBody: Record<string, unknown> = {};

    beforeAll(async () => {
      backend = await createMockBackend((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf-8");
        });
        req.on("end", () => {
          capturedBody = JSON.parse(body) as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(VALID_RESPONSE);
        });
      });
    });

    afterAll(async () => {
      await backend.close();
    });

    // --- Test 7: maxTokens in request body ---

    it("sends max_tokens in request body with correct numeric value", async () => {
      await callLLM({
        baseUrl: `http://127.0.0.1:${backend.port}`,
        upstreamPath: "/v1/chat/completions",
        apiKey: "test-key",
        model: "gpt-4",
        messages: [{ role: "user", content: "Test" }],
        maxTokens: 200,
      });

      expect(capturedBody.max_tokens).toBe(200);
    });
  });

  // =================== HTTP ERROR ===================

  describe("HTTP error handling", () => {
    // --- Test 3: 500 error ---

    it("throws error with status code on 500 response", async () => {
      const backend = await createMockBackend((_req, res) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Internal Server Error",
              type: "server_error",
            },
          }),
        );
      });

      try {
        await callLLM({
          baseUrl: `http://127.0.0.1:${backend.port}`,
          upstreamPath: "/v1/chat/completions",
          apiKey: "test-key",
          model: "gpt-4",
          messages: [{ role: "user", content: "Test" }],
        });
        expect.fail("Expected callLLM to throw");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
        const err = e as Error;
        expect(err.message).toContain("LLM API error");
        expect(err.message).toContain("500");
      } finally {
        await backend.close();
      }
    });
  });

  // =================== TIMEOUT ===================

  describe("timeout", () => {
    // --- Test 4: timeout ---

    it("throws timeout error when server is too slow", async () => {
      const backend = await createMockBackend((req, _res) => {
        // Consume request body but never send a response
        req.on("data", () => {});
        req.on("end", () => {
          // Intentionally never call res.end()
        });
      });

      try {
        await callLLM({
          baseUrl: `http://127.0.0.1:${backend.port}`,
          upstreamPath: "/v1/chat/completions",
          apiKey: "test-key",
          model: "gpt-4",
          messages: [{ role: "user", content: "Test" }],
          timeoutMs: 100,
        });
        expect.fail("Expected callLLM to throw");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
        const err = e as Error;
        expect(err.message.toLowerCase()).toContain("timeout");
      } finally {
        await backend.close();
      }
    });
  });

  // =================== PARSE ERROR ===================

  describe("response parse error", () => {
    // --- Test 5: non-JSON response ---

    it("throws parse error on non-JSON response body", async () => {
      const backend = await createMockBackend((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("This is not JSON");
      });

      try {
        await callLLM({
          baseUrl: `http://127.0.0.1:${backend.port}`,
          upstreamPath: "/v1/chat/completions",
          apiKey: "test-key",
          model: "gpt-4",
          messages: [{ role: "user", content: "Test" }],
        });
        expect.fail("Expected callLLM to throw");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
        const err = e as Error;
        expect(err.message.toLowerCase()).toContain("parse");
        expect(err.message.toLowerCase()).toContain("llm");
      } finally {
        await backend.close();
      }
    });
  });

  // =================== HTTPS PROTOCOL ===================

  describe("HTTPS protocol support", () => {
    // --- Test 8: https URL ---

    it("supports https URLs with self-signed certificate", async () => {
      // Generate self-signed certificate
      const { key, cert } = generateSelfSignedCert();

      // Create HTTPS mock server bound to 127.0.0.1
      const server = https.createServer({ key, cert }, (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(VALID_RESPONSE);
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          resolve(
            typeof addr === "object" && addr ? addr.port : 0,
          );
        });
      });

      // Allow self-signed certificates for this test
      const origRejectUnauthorized =
        process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

      try {
        const result = await callLLM({
          baseUrl: `https://127.0.0.1:${port}`,
          upstreamPath: "/v1/chat/completions",
          apiKey: "test-key",
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        });

        expect(result.content).toBe("Hello!");
      } finally {
        // Restore env var
        if (origRejectUnauthorized === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED =
            origRejectUnauthorized;
        }

        await closeServer(server);
      }
    });
  });
});
