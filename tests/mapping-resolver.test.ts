import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { resolveMapping } from "../src/proxy/mapping-resolver.js";
import { initDatabase } from "../src/db/index.js";

describe("resolveMapping", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("returns null when client_model does not exist", () => {
    const result = resolveMapping(db, "unknown-model", { now: new Date() });
    expect(result).toBeNull();
  });

  it("returns default target when no time window matches", () => {
    const rule = JSON.stringify({
      default: { backend_model: "gpt-4o", provider_id: "p1" },
      windows: [
        { start: "02:00", end: "04:00", target: { backend_model: "gpt-4", provider_id: "p2" } },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "scheduled", rule, new Date().toISOString());

    const now = new Date("2024-01-01T10:00:00");
    const result = resolveMapping(db, "my-model", { now });
    expect(result).toEqual({ backend_model: "gpt-4o", provider_id: "p1" });
  });

  it("returns window target when current time matches", () => {
    const rule = JSON.stringify({
      default: { backend_model: "gpt-4o", provider_id: "p1" },
      windows: [
        { start: "09:00", end: "11:00", target: { backend_model: "gpt-4", provider_id: "p2" } },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "scheduled", rule, new Date().toISOString());

    const now = new Date("2024-01-01T10:00:00");
    const result = resolveMapping(db, "my-model", { now });
    expect(result).toEqual({ backend_model: "gpt-4", provider_id: "p2" });
  });

  it("returns null when rule JSON is invalid", () => {
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "bad-model", "scheduled", "not-json", new Date().toISOString());

    const result = resolveMapping(db, "bad-model", { now: new Date() });
    expect(result).toBeNull();
  });

  it("returns null when strategy is unknown", () => {
    const rule = JSON.stringify({ default: { backend_model: "gpt-4o", provider_id: "p1" } });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "unknown", rule, new Date().toISOString());

    const result = resolveMapping(db, "my-model", { now: new Date() });
    expect(result).toBeNull();
  });

  it("resolves round-robin strategy", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "round-robin", rule, new Date().toISOString());

    const result = resolveMapping(db, "my-model", { now: new Date() });
    expect(result).toEqual({ backend_model: "gpt-4", provider_id: "p1" });
  });

  it("resolves random strategy", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "random", rule, new Date().toISOString());

    const result = resolveMapping(db, "my-model", { now: new Date() });
    expect(result?.backend_model).toBeDefined();
    expect(result?.provider_id).toBeDefined();
  });

  it("resolves failover strategy", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "failover", rule, new Date().toISOString());

    const result = resolveMapping(db, "my-model", { now: new Date() });
    expect(result).toEqual({ backend_model: "gpt-4", provider_id: "p1" });
  });

  it("resolves failover with excludeTargets", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", "failover", rule, new Date().toISOString());

    const result = resolveMapping(db, "my-model", {
      now: new Date(),
      excludeTargets: [{ backend_model: "gpt-4", provider_id: "p1" }],
    });
    expect(result).toEqual({ backend_model: "claude-3", provider_id: "p2" });
  });
});
