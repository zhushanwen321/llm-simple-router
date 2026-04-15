import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authMiddleware } from "../src/middleware/auth.js";

const VALID_KEY = "sk-router-test-key";

function buildApp() {
  const app = Fastify();
  app.register(authMiddleware, { apiKey: VALID_KEY });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/admin/dashboard", async () => ({ page: "admin" }));
  app.get("/v1/chat/completions", async () => ({ result: "proxied" }));

  return app;
}

describe("auth middleware", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("should allow /health without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("should allow /admin/* without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: "admin" });
  });

  it("should reject request without Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("invalid_api_key");
  });

  it("should reject request with wrong API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer wrong-key",
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.message).toBe("Invalid API key");
  });

  it("should allow request with correct Bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${VALID_KEY}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: "proxied" });
  });

  it("should reject malformed Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Basic some-credentials",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("should return OpenAI-compatible error format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    const body = response.json();
    expect(body).toEqual({
      error: {
        message: "Invalid API key",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  });
});
