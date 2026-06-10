import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../router/src/db/index.js";
import { createMappingGroup } from "../../router/src/db/mappings.js";
import { createProvider } from "../../router/src/db/providers.js";
import { precomputeFailoverTargets } from "../../router/src/proxy/handler/failover-loop.js";
import { PipelineSnapshot } from "../../router/src/proxy/pipeline-snapshot.js";

function seedProvider(db: Database.Database, name: string, models: string[]): string {
  return createProvider(db, {
    name,
    api_type: "openai",
    base_url: "http://localhost",
    api_key: "test-key",
    models: JSON.stringify(models.map(m => ({ model: m }))),
  });
}

function seedMapping(db: Database.Database, clientModel: string, providerId: string, backendModel: string) {
  createMappingGroup(db, {
    client_model: clientModel,
    rule: JSON.stringify({ targets: [{ provider_id: providerId, backend_model: backendModel }] }),
  });
}

describe("precomputeFailoverTargets", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("returns no_mapping when resolveMapping returns null", () => {
    const result = precomputeFailoverTargets({
      db,
      clientModel: "unmapped-model",
      body: {},
      precomputeSnapshot: new PipelineSnapshot(),
      allowedModels: undefined,
      enhancementConfig: { tool_error_logging_enabled: false } as never,
    });

    expect(result).toEqual({ ok: false, errorCode: "no_mapping" });
  });

  it("returns ok with targets on valid mapping", () => {
    const providerId = seedProvider(db, "p1", ["gpt-4"]);
    seedMapping(db, "gpt-4", providerId, "gpt-4");

    const result = precomputeFailoverTargets({
      db,
      clientModel: "gpt-4",
      body: {},
      precomputeSnapshot: new PipelineSnapshot(),
      allowedModels: undefined,
      enhancementConfig: { tool_error_logging_enabled: false } as never,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cachedTargets.length).toBeGreaterThan(0);
      expect(result.cachedTargets[0].provider_id).toBe(providerId);
      expect(result.cachedTargets[0].backend_model).toBe("gpt-4");
    }
  });

  it("returns no_allowed_model when allowed_models filters all targets", () => {
    const providerId = seedProvider(db, "p1", ["gpt-4"]);
    seedMapping(db, "gpt-4", providerId, "gpt-4");

    const result = precomputeFailoverTargets({
      db,
      clientModel: "gpt-4",
      body: {},
      precomputeSnapshot: new PipelineSnapshot(),
      allowedModels: ["claude-3"],
      enhancementConfig: { tool_error_logging_enabled: false } as never,
    });

    expect(result).toEqual({ ok: false, errorCode: "no_allowed_model" });
  });
});
