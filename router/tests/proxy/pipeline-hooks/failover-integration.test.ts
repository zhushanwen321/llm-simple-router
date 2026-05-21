/**
 * Failover + Pipeline Hook Priority 集成测试
 *
 * TC-8-02: Failover with 2 targets: first fails, second succeeds
 * TC-8-03: ProviderSwitchNeeded triggers continue in failover loop
 * TC-9-01: Hook priority ordering: external hook runs after builtins
 * TC-9-02: PipelineAbort from hook short-circuits pipeline
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { type FastifyInstance } from "fastify";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { buildApp } from "../../../src/index.js";
import { encrypt } from "../../../src/utils/crypto.js";
import { initDatabase } from "../../../src/db/index.js";
import { setSetting } from "../../../src/db/settings.js";
import { hashPassword } from "../../../src/utils/password.js";
import { DEFAULT_LOOP_PREVENTION_CONFIG } from "../../../src/core/loop-prevention/index.js";
import { ProxyPipeline } from "../../../src/proxy/pipeline/pipeline.js";
import { PipelineAbort } from "../../../src/proxy/pipeline/types.js";
import type { PipelineContext, PipelineHook, HookPhase } from "../../../src/proxy/pipeline/types.js";
import { PipelineSnapshot } from "../../../src/proxy/pipeline-snapshot.js";

// ---------- Constants ----------

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const API_KEY = "sk-failover-integration-test";

// ---------- Helpers ----------

function makeTestConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent" as const,
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_BASE_DELAY_MS: 0,
    LOOP_PREVENTION: { ...DEFAULT_LOOP_PREVENTION_CONFIG, enabled: false },
  };
}

function createMockBackend(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
  });
}

function safeClose(server: Server): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    try { server.close(() => resolve()); } catch { resolve(); }
  });
}

const OPENAI_SUCCESS = {
  id: "chatcmpl-1",
  object: "chat.completion",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Hello!" },
    finish_reason: "stop",
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: "gpt-4",
};

function openaiError(statusCode: number, message: string) {
  return { error: { message, type: "server_error", code: statusCode } };
}

// ============================================================
// TC-8-02 & TC-8-03: Failover integration tests
// ============================================================

describe("Failover integration", () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;
  let closeFn: (() => Promise<void>) | undefined;
  let serversToClean: Server[] = [];

  function trackServer(s: Server) {
    serversToClean.push(s);
    return s;
  }

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "jwt_secret", "test-jwt-secret-for-failover-integration");
    setSetting(db, "admin_password_hash", hashPassword("admin123"));
    setSetting(db, "initialized", "true");
    app = undefined;
    closeFn = undefined;
    serversToClean = [];
  });

  afterEach(async () => {
    if (closeFn) await closeFn();
    for (const s of serversToClean) await safeClose(s);
    if (db && db.open) db.close();
  });

  const AUTH_HEADER = { authorization: `Bearer ${API_KEY}` };

  function insertRouterKey() {
    const apiKeyHash = createHash("sha256").update(API_KEY).digest("hex");
    db.prepare(
      "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
    ).run("test-key-id", "Test Key", apiKeyHash, API_KEY.slice(0, 8));
  }

  function insertProvider(id: string, name: string, baseUrl: string, encryptedKey: string) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, "openai", baseUrl, encryptedKey, 1, now, now);
  }

  function insertMappingGroup(
    clientModel: string,
    targets: Array<{ backend_model: string; provider_id: string }>,
  ) {
    const now = new Date().toISOString();
    const id = `mg-${clientModel}`;
    for (const t of targets) {
      db.prepare(
        `INSERT OR IGNORE INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(`mm-${t.provider_id}-${t.backend_model}`, clientModel, t.backend_model, t.provider_id, 1, now);
    }
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, clientModel, JSON.stringify({ targets }), 1, now);
  }

  // ---------- TC-8-02 ----------

  it("TC-8-02: first target returns 500, failover to second returns 200", async () => {
    let providerACalls = 0;
    let providerBCalls = 0;

    // Provider A: always returns 500
    const backendA = await createMockBackend((_req, res) => {
      providerACalls++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(openaiError(500, "Provider A internal error")));
    });
    trackServer(backendA.server);

    // Provider B: always returns 200
    const backendB = await createMockBackend((_req, res) => {
      providerBCalls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(backendB.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-a", "Provider A", `http://127.0.0.1:${backendA.port}`, encryptedKey);
    insertProvider("svc-b", "Provider B", `http://127.0.0.1:${backendB.port}`, encryptedKey);

    // Failover group: A first, then B
    insertMappingGroup("gpt-4", [
      { backend_model: "gpt-4", provider_id: "svc-a" },
      { backend_model: "gpt-4", provider_id: "svc-b" },
    ]);

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    // Second provider should have returned 200
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe("chatcmpl-1");

    // Both providers should have been called exactly once
    expect(providerACalls).toBe(1);
    expect(providerBCalls).toBe(1);

    // Verify logs: first attempt failed, second succeeded
    const logs = db.prepare(
      "SELECT provider_id, status_code FROM request_logs ORDER BY created_at",
    ).all() as Array<{ provider_id: string; status_code: number }>;
    expect(logs.length).toBe(2);
    expect(logs[0].provider_id).toBe("svc-a");
    expect(logs[0].status_code).toBe(500);
    expect(logs[1].provider_id).toBe("svc-b");
    expect(logs[1].status_code).toBe(200);
  });

  // ---------- TC-8-03 ----------

  it("TC-8-03: ProviderSwitchNeeded triggers continue — resilience retries then failover succeeds", async () => {
    // Scenario: Provider A fails with 500 on first call, then succeeds on retry;
    // but we test the simpler case: Provider A always fails, Provider B succeeds.
    // The failover loop catches ProviderSwitchNeeded from the orchestrator's
    // resilience layer and continues to the next target.
    let providerACalls = 0;
    let providerBCalls = 0;

    // Provider A: always returns 500 (triggers resilience → ProviderSwitchNeeded)
    const backendA = await createMockBackend((_req, res) => {
      providerACalls++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(openaiError(500, "Provider A error")));
    });
    trackServer(backendA.server);

    // Provider B: returns 200
    const backendB = await createMockBackend((_req, res) => {
      providerBCalls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(backendB.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-a", "Provider A", `http://127.0.0.1:${backendA.port}`, encryptedKey);
    insertProvider("svc-b", "Provider B", `http://127.0.0.1:${backendB.port}`, encryptedKey);

    insertMappingGroup("gpt-4", [
      { backend_model: "gpt-4", provider_id: "svc-a" },
      { backend_model: "gpt-4", provider_id: "svc-b" },
    ]);

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    // Failover to Provider B succeeds
    expect(response.statusCode).toBe(200);

    // Provider A was attempted, then Provider B
    expect(providerACalls).toBeGreaterThanOrEqual(1);
    expect(providerBCalls).toBeGreaterThanOrEqual(1);

    // Verify pipeline_snapshot contains failover evidence
    const successLogs = db.prepare(
      "SELECT pipeline_snapshot FROM request_logs WHERE status_code = 200",
    ).all() as Array<{ pipeline_snapshot: string }>;
    expect(successLogs.length).toBeGreaterThanOrEqual(1);

    const stages = JSON.parse(successLogs[0].pipeline_snapshot || "[]");
    const routingStage = stages.find((s: Record<string, unknown>) => s.stage === "routing");
    expect(routingStage).toBeDefined();
    // The successful log should show provider B as the target
    expect(routingStage.provider_id).toBe("svc-b");
  });
});

// ============================================================
// TC-9-01 & TC-9-02: Pipeline hook priority tests
// ============================================================

/** Construct a minimal mock PipelineContext for unit-level pipeline tests */
function mockContext(): PipelineContext {
  return {
    request: { log: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: {},
    clientModel: "gpt-4o",
    apiType: "openai",
    body: {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "",
    injectedHeaders: {},
    metadata: new Map(),
    logId: "test-log-id",
    rootLogId: null,
    transportResult: null,
    resilienceResult: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: new PipelineSnapshot(),
  };
}

/** Factory: create a PipelineHook */
function makeHook(
  name: string,
  phase: HookPhase,
  priority: number,
  core: boolean | undefined,
  fn: (ctx: PipelineContext) => void | Promise<void>,
): PipelineHook {
  return { name, phase, priority, core, execute: fn };
}

describe("Pipeline hook priority", () => {
  // ---------- TC-9-01 ----------

  it("TC-9-01: external hook (priority=200) runs after builtins (priority<200)", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();
    const executed: string[] = [];

    // Builtin hooks: priority 0-199
    pipeline.register(makeHook("builtin-infra", "pre_route", 10, true, () => {
      executed.push("builtin-infra");
    }));
    pipeline.register(makeHook("builtin-routing", "pre_route", 100, true, () => {
      executed.push("builtin-routing");
    }));
    pipeline.register(makeHook("builtin-enhancement", "pre_route", 150, undefined, () => {
      executed.push("builtin-enhancement");
    }));

    // External plugin hook: priority 200+
    pipeline.register(makeHook("external-plugin", "pre_route", 200, undefined, () => {
      executed.push("external-plugin");
    }));

    // Observer hook: priority 900+
    pipeline.register(makeHook("observer-logger", "pre_route", 900, undefined, () => {
      executed.push("observer-logger");
    }));

    await pipeline.emit("pre_route", ctx);

    // Execution order must be: infra → routing → enhancement → plugin → observer
    expect(executed).toEqual([
      "builtin-infra",
      "builtin-routing",
      "builtin-enhancement",
      "external-plugin",
      "observer-logger",
    ]);
  });

  // ---------- TC-9-02 ----------

  it("TC-9-02: PipelineAbort from hook short-circuits pipeline — later hooks do not run", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();
    const executed: string[] = [];

    // Hook at priority 100 — runs first, throws PipelineAbort
    pipeline.register(makeHook("aborting-hook", "pre_transport", 100, undefined, () => {
      executed.push("aborting-hook");
      throw new PipelineAbort(403, { error: { message: "Forbidden by policy", type: "policy_violation" } });
    }));

    // Hook at priority 400 — should NOT run (short-circuited)
    pipeline.register(makeHook("later-hook", "pre_transport", 400, undefined, () => {
      executed.push("later-hook");
    }));

    // Observer at priority 900 — should NOT run either
    pipeline.register(makeHook("observer", "pre_transport", 900, undefined, () => {
      executed.push("observer");
    }));

    // emit should throw PipelineAbort
    await expect(pipeline.emit("pre_transport", ctx)).rejects.toThrow("Pipeline aborted");

    // Only the aborting hook should have executed
    expect(executed).toEqual(["aborting-hook"]);

    // Verify the caught error has correct properties
    try {
      await pipeline.emit("pre_transport", ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineAbort);
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(403);
      expect(abort.body).toEqual({ error: { message: "Forbidden by policy", type: "policy_violation" } });
    }
  });
});
