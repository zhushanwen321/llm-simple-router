import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { seedSettings } from "./helpers/test-setup.js";
import { expandOverflowTargets } from "../src/proxy/routing/overflow.js";
import type { Target } from "../src/core/types.js";

/**
 * TDD FAILING tests for expandOverflowTargets().
 * Function does not exist yet — all tests must FAIL.
 */
describe("expandOverflowTargets", () => {
  let db: Database.Database;

  beforeEach(() => {
  db = initDatabase(":memory:");
  seedSettings(db);
  // Provider with small context window so overflow triggers on long content
  db.prepare(
    "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  )
    .run("p1", "provider-1", "openai", "http://localhost:1111", "", '["small-model"]', 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO provider_model_info (provider_id, model_name, context_window) VALUES (?,?,?)")
    .run("p1", "small-model", 200);
  });

  it("target with overflow fields prepends overflow target before original", () => {
  // Target A has overflow configured, Target B does not
  const targetA: Target = {
    provider_id: "p1",
    backend_model: "small-model",
    overflow_provider_id: "p-overflow",
    overflow_model: "big-model",
  };
  const targetB: Target = {
    provider_id: "p1",
    backend_model: "small-model",
  };

  // Long content that exceeds small-model's 200-token context window
  const longContent = "a".repeat(2_000_000);
  const body = { messages: [{ role: "user", content: longContent }] };

  const result = expandOverflowTargets([targetA, targetB], db, body);

  // Expect: [overflow_target, targetA, targetB]
  expect(result.targets).toHaveLength(3);
  expect(result.targets[0]).toEqual({
    provider_id: "p-overflow",
    backend_model: "big-model",
  });
  expect(result.targets[1]).toBe(targetA);
  expect(result.targets[2]).toBe(targetB);
  });

  it("IR fallback target without overflow fields is not expanded", () => {
  // Simulates an IR fallback target — no overflow_provider_id/overflow_model
  const irFallback: Target = {
    provider_id: "p1",
    backend_model: "small-model",
  };

  // Even with long content, no overflow fields means no expansion
  const longContent = "a".repeat(2_000_000);
  const body = { messages: [{ role: "user", content: longContent }] };

  const result = expandOverflowTargets([irFallback], db, body);

  expect(result.targets).toHaveLength(1);
  expect(result.targets[0]).toBe(irFallback);
  });

  it("empty targets array returns empty result", () => {
  const body = { messages: [{ role: "user", content: "hello" }] };

  const result = expandOverflowTargets([], db, body);

  expect(result.targets).toEqual([]);
  });

  it("exception in applyOverflowRedirect for one target does not block others", () => {
  // Target with invalid provider_id — applyOverflowRedirect will still be called
  // but overflow fields are present so it will attempt overflow computation
  const targetA: Target = {
    provider_id: "nonexistent-provider",
    backend_model: "unknown-model",
    overflow_provider_id: "also-nonexistent",
    overflow_model: "big-model",
  };
  const targetB: Target = {
    provider_id: "p1",
    backend_model: "small-model",
  };

  const body = { messages: [{ role: "user", content: "short" }] };

  // Should not throw — targetA's overflow computation may fail but targetB proceeds
  const result = expandOverflowTargets([targetA, targetB], db, body);

  // Both original targets must be present in result
  expect(result.targets).toContain(targetA);
  expect(result.targets).toContain(targetB);
  });
});
