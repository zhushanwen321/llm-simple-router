import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { buildApp } from "../src/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

// 这些函数尚未实现，测试必须在运行时 FAIL
import {
  getClientSessionHeaders,
  setClientSessionHeaders,
} from "../src/db/settings.js";

const DEFAULT_HEADERS = [
  { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
  { client_type: "pi", session_header_key: "x-pi-session-id" },
];

// ========== DB 层测试 ==========
describe("getClientSessionHeaders — DB 层", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("getClientSessionHeaders 默认值 — 无 setting 行时返回默认配置", () => {
    const result = getClientSessionHeaders(db);
    expect(result).toEqual(DEFAULT_HEADERS);
  });

  it("getClientSessionHeaders 自定义值 — 写入后读取返回自定义配置", () => {
    const custom = [
      { client_type: "cursor", session_header_key: "x-cursor-session-id" },
      { client_type: "windsurf", session_header_key: "x-windsurf-session-id" },
    ];
    setClientSessionHeaders(db, custom);

    const result = getClientSessionHeaders(db);
    expect(result).toEqual(custom);
  });

  it("getClientSessionHeaders 损坏的 JSON — 回退到默认值", () => {
    // 直接在 DB 写入非法 JSON
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "client_session_headers",
      "not-valid-json",
    );

    const result = getClientSessionHeaders(db);
    expect(result).toEqual(DEFAULT_HEADERS);
  });
});

describe("setClientSessionHeaders — DB 层", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("setClientSessionHeaders — 写入后 DB 中存储正确的 JSON", () => {
    const entries = [
      { client_type: "my-client", session_header_key: "x-my-session" },
    ];
    setClientSessionHeaders(db, entries);

    // 通过 getSetting 验证原始 DB 存储
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("client_session_headers") as { value: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.value).toBe(JSON.stringify(entries));
  });

  it("setClientSessionHeaders — 覆盖已有配置", () => {
    const first = [{ client_type: "a", session_header_key: "x-a" }];
    const second = [
      { client_type: "b", session_header_key: "x-b" },
      { client_type: "c", session_header_key: "x-c" },
    ];

    setClientSessionHeaders(db, first);
    setClientSessionHeaders(db, second);

    const result = getClientSessionHeaders(db);
    expect(result).toEqual(second);
    expect(result).toHaveLength(2);
  });

  it("setClientSessionHeaders 空数组 — 应抛错", () => {
    // 先确保正常调用能成功（排除函数未定义导致的假阳性）
    setClientSessionHeaders(db, [{ client_type: "ok", session_header_key: "x-ok" }]);
    // 空数组必须抛错
    expect(() => setClientSessionHeaders(db, [])).toThrow(/at least|empty|invalid/i);
  });
});

// ========== Admin API 测试 ==========
describe("Client Session Headers — Admin API", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    const db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET /admin/api/settings/client-session-headers — 返回默认配置", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/settings/client-session-headers",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.entries).toEqual(DEFAULT_HEADERS);
  });

  it("PUT /admin/api/settings/client-session-headers — 成功更新后 GET 验证返回新值", async () => {
    const newEntries = [
      { client_type: "cursor", session_header_key: "x-cursor-session-id" },
      { client_type: "cline", session_header_key: "x-cline-session-id" },
      { client_type: "aider", session_header_key: "x-aider-session-id" },
    ];

    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: { entries: newEntries },
      headers: { cookie },
    });
    expect(putRes.statusCode).toBe(200);

    // 通过 GET 验证持久化
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/settings/client-session-headers",
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.entries).toEqual(newEntries);
  });

  it("PUT 验证失败 — entries 为空数组 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: { entries: [] },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
  });

  it("PUT 验证失败 — client_type 为空字符串 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ client_type: "", session_header_key: "x-valid" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
  });

  it("PUT 验证失败 — session_header_key 为空字符串 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ client_type: "my-client", session_header_key: "" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
  });

  it("PUT 验证失败 — client_type 缺失 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ session_header_key: "x-valid" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 验证失败 — session_header_key 缺失 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ client_type: "my-client" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 验证失败 — entries 不是数组 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: { entries: "not-an-array" },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
