import { describe, it, expect } from "vitest";
import { pluginMatches, type TransformPlugin } from "../../../src/proxy/transform/plugin-types.js";

describe("pluginMatches", () => {
  const provider = { id: "p1", name: "bedrock-claude", api_type: "anthropic" };

  it("matches by providerId", () => {
    const plugin: TransformPlugin = { name: "test", match: { providerId: "p1" } };
    expect(pluginMatches(plugin, provider)).toBe(true);
    expect(pluginMatches(plugin, { ...provider, id: "p2" })).toBe(false);
  });

  it("matches by providerName", () => {
    const plugin: TransformPlugin = { name: "test", match: { providerName: "bedrock-claude" } };
    expect(pluginMatches(plugin, provider)).toBe(true);
    expect(pluginMatches(plugin, { ...provider, name: "other" })).toBe(false);
  });

  it("matches by providerNamePattern", () => {
    const plugin: TransformPlugin = { name: "test", match: { providerNamePattern: "^bedrock" } };
    expect(pluginMatches(plugin, provider)).toBe(true);
    expect(pluginMatches(plugin, { ...provider, name: "other" })).toBe(false);
  });

  it("matches by apiType", () => {
    const plugin: TransformPlugin = { name: "test", match: { apiType: "anthropic" } };
    expect(pluginMatches(plugin, provider)).toBe(true);
    expect(pluginMatches(plugin, { ...provider, api_type: "openai" })).toBe(false);
  });

  it("matches with empty match (matches all)", () => {
    const plugin: TransformPlugin = { name: "test", match: {} };
    expect(pluginMatches(plugin, provider)).toBe(true);
  });

  it("matches with multiple conditions (AND)", () => {
    const plugin: TransformPlugin = { name: "test", match: { providerId: "p1", apiType: "anthropic" } };
    expect(pluginMatches(plugin, provider)).toBe(true);
    expect(pluginMatches(plugin, { ...provider, api_type: "openai" })).toBe(false);
  });
});
