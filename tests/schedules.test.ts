import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import {
  createSchedule,
  getScheduleById,
  getSchedulesByGroup,
  getActiveSchedulesForGroup,
  getAllSchedules,
  updateSchedule,
  deleteSchedule,
  deleteSchedulesByGroup,
} from "../src/db/schedules.js";

const VALID_RULE = (providerId: string) => JSON.stringify({
  targets: [{ backend_model: "gpt-4-turbo", provider_id: providerId }],
});

async function createGroup(app: FastifyInstance, cookie: string, providerId: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: `test-model-${Date.now()}`,
      rule: VALID_RULE(providerId),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

describe("Schedules DB layer", () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("createSchedule returns id and getScheduleById retrieves it", () => {
    const groupId = "test-group";
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
      .run(groupId, "test-model", '{"targets":[]}', new Date().toISOString());

    const id = createSchedule(db, {
      mapping_group_id: groupId,
      name: "Work Hours",
      week: "[1,2,3,4,5]",
      start_hour: 9,
      end_hour: 18,
      mapping_rule: '{"targets":[{"backend_model":"gpt-4","provider_id":"p1"}]}',
    });
    expect(id).toBeDefined();

    const s = getScheduleById(db, id);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Work Hours");
    expect(s!.start_hour).toBe(9);
    expect(s!.end_hour).toBe(18);
    expect(s!.enabled).toBe(1);
  });

  it("getSchedulesByGroup returns only schedules for that group", () => {
    const g1 = "group-1";
    const g2 = "group-2";
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`).run(g1, "m1", '{}', now);
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`).run(g2, "m2", '{}', now);

    createSchedule(db, { mapping_group_id: g1, name: "S1", week: "[1]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    createSchedule(db, { mapping_group_id: g1, name: "S2", week: "[2]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    createSchedule(db, { mapping_group_id: g2, name: "S3", week: "[3]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });

    expect(getSchedulesByGroup(db, g1).length).toBe(2);
    expect(getSchedulesByGroup(db, g2).length).toBe(1);
  });

  it("getActiveSchedulesForGroup returns only enabled=1", () => {
    const g = "group-a";
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
      .run(g, "ma", '{}', new Date().toISOString());

    const id1 = createSchedule(db, { mapping_group_id: g, name: "Active", week: "[1]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    const id2 = createSchedule(db, { mapping_group_id: g, name: "Disabled", week: "[2]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    updateSchedule(db, id2, { enabled: 0 });

    const active = getActiveSchedulesForGroup(db, g);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(id1);
  });

  it("getAllSchedules returns all schedules", () => {
    const g = "group-all";
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
      .run(g, "mall", '{}', new Date().toISOString());

    createSchedule(db, { mapping_group_id: g, name: "A", week: "[1]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    createSchedule(db, { mapping_group_id: g, name: "B", week: "[2]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });

    expect(getAllSchedules(db).length).toBeGreaterThanOrEqual(2);
  });

  it("updateSchedule partial updates fields", () => {
    const g = "group-upd";
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
      .run(g, "mupd", '{}', new Date().toISOString());

    const id = createSchedule(db, { mapping_group_id: g, name: "Original", week: "[1]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    updateSchedule(db, id, { name: "Updated", start_hour: 10 });

    const s = getScheduleById(db, id);
    expect(s!.name).toBe("Updated");
    expect(s!.start_hour).toBe(10);
    expect(s!.end_hour).toBe(24);
  });

  it("deleteSchedule removes schedule", () => {
    const g = "group-del";
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
      .run(g, "mdel", '{}', new Date().toISOString());

    const id = createSchedule(db, { mapping_group_id: g, name: "ToDelete", week: "[1]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    expect(getScheduleById(db, id)).toBeDefined();
    deleteSchedule(db, id);
    expect(getScheduleById(db, id)).toBeUndefined();
  });

  it("deleteSchedulesByGroup removes all schedules for group", () => {
    const g = "group-delall";
    db.prepare(`INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
      .run(g, "mdelall", '{}', new Date().toISOString());

    createSchedule(db, { mapping_group_id: g, name: "A", week: "[1]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });
    createSchedule(db, { mapping_group_id: g, name: "B", week: "[2]", start_hour: 0, end_hour: 24, mapping_rule: '{}' });

    expect(getSchedulesByGroup(db, g).length).toBe(2);
    deleteSchedulesByGroup(db, g);
    expect(getSchedulesByGroup(db, g).length).toBe(0);
  });
});

describe("Schedules Admin API", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let providerId: string;
  let groupId: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-Provider",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-key",
      },
    });
    providerId = res.json().data.id;
    groupId = await createGroup(app, cookie, providerId);
  });

  afterEach(async () => {
    await close();
  });

  // Helper: 创建一个 schedule 并返回其 id
  async function createTestSchedule(overrides?: Record<string, unknown>): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        mapping_group_id: groupId,
        name: "Test Schedule",
        week: "[1,2,3,4,5]",
        start_hour: 9,
        end_hour: 18,
        mapping_rule: VALID_RULE(providerId),
        ...overrides,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id;
  }

  it("GET /admin/api/schedules returns all schedules", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/schedules",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe(0);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("GET /admin/api/schedules/group/:groupId returns schedules for group", async () => {
    await createTestSchedule();

    const res = await app.inject({
      method: "GET",
      url: `/admin/api/schedules/group/${groupId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(1);
    expect(res.json().data[0].name).toBe("Test Schedule");
  });

  it("GET /admin/api/schedules/group/:invalidId returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/schedules/group/nonexistent-id",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /admin/api/schedules creates schedule", async () => {
    const id = await createTestSchedule({ name: "Work Hours" });
    expect(id).toBeDefined();
  });

  it("POST /admin/api/schedules rejects invalid mapping_rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        mapping_group_id: groupId,
        name: "Bad Rule",
        week: "[1]",
        start_hour: 0,
        end_hour: 24,
        mapping_rule: "not-valid-json",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /admin/api/schedules rejects invalid week", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        mapping_group_id: groupId,
        name: "Bad Week",
        week: "not-array",
        start_hour: 0,
        end_hour: 24,
        mapping_rule: VALID_RULE(providerId),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /admin/api/schedules rejects start_hour >= end_hour", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        mapping_group_id: groupId,
        name: "Bad Hours",
        week: "[1]",
        start_hour: 18,
        end_hour: 9,
        mapping_rule: VALID_RULE(providerId),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /admin/api/schedules rejects time overlap", async () => {
    await createTestSchedule();

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        mapping_group_id: groupId,
        name: "Overlap",
        week: "[1,2,3,4,5]",
        start_hour: 10,
        end_hour: 20,
        mapping_rule: VALID_RULE(providerId),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("重叠");
  });

  it("PUT /admin/api/schedules/:id updates schedule", async () => {
    const id = await createTestSchedule({ name: "Original" });

    const res = await app.inject({
      method: "PUT",
      url: `/admin/api/schedules/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.success).toBe(true);

    // Verify update
    const listRes = await app.inject({
      method: "GET",
      url: `/admin/api/schedules/group/${groupId}`,
      headers: { cookie },
    });
    expect(listRes.json().data[0].name).toBe("Updated");
  });

  it("PUT /admin/api/schedules/:invalidId returns 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/schedules/nonexistent-id",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "Update" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /admin/api/schedules/:id deletes schedule", async () => {
    const id = await createTestSchedule({ name: "To Delete" });

    const res = await app.inject({
      method: "DELETE",
      url: `/admin/api/schedules/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);

    // Verify deleted
    const listRes = await app.inject({
      method: "GET",
      url: `/admin/api/schedules/group/${groupId}`,
      headers: { cookie },
    });
    expect(listRes.json().data.length).toBe(0);
  });

  it("DELETE /admin/api/schedules/:invalidId returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/api/schedules/nonexistent-id",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /admin/api/schedules/:id/toggle toggles enabled", async () => {
    const id = await createTestSchedule({ name: "Toggle Test" });

    // Toggle to disabled
    const res1 = await app.inject({
      method: "POST",
      url: `/admin/api/schedules/${id}/toggle`,
      headers: { cookie },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().data.enabled).toBe(0);

    // Toggle back to enabled
    const res2 = await app.inject({
      method: "POST",
      url: `/admin/api/schedules/${id}/toggle`,
      headers: { cookie },
    });
    expect(res2.json().data.enabled).toBe(1);
  });

  it("POST /admin/api/schedules/:invalidId/toggle returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules/nonexistent-id/toggle",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
