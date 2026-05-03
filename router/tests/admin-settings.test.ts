import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { ServiceContainer } from "../src/core/container.js";


describe("Admin Settings API", () => {
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

  it("GET /settings/log-retention returns default 3", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/settings/log-retention",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ days: 3 });
  });

  it("PUT /settings/log-retention updates value", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: 7 },
      headers: { cookie },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().data).toEqual({ days: 7 });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/settings/log-retention",
      headers: { cookie },
    });
    expect(getRes.json().data).toEqual({ days: 7 });
  });

  it("PUT rejects invalid days (negative)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: -1 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("PUT rejects invalid days (> 90)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: 91 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("PUT accepts 0 (disable auto cleanup)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: 0 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ days: 0 });
  });

  it("GET /settings/db-size returns defaults", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/settings/db-size",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.thresholds.dbMaxSizeMb).toBe(1024);
    expect(body.thresholds.logTableMaxSizeMb).toBe(800);
  });

  it("PUT /settings/db-size-thresholds updates values", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/db-size-thresholds",
      payload: { dbMaxSizeMb: 2048, logTableMaxSizeMb: 1600 },
      headers: { cookie },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().data).toEqual({ dbMaxSizeMb: 2048, logTableMaxSizeMb: 1600 });
  });

  it("PUT /settings/db-size-thresholds rejects invalid values", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/db-size-thresholds",
      payload: { dbMaxSizeMb: -1 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });
});
