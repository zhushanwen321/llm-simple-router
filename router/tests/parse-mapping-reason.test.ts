import { describe, it, expect } from "vitest";
import { parseMappingReason } from "../src/utils/mapping-reason-parser.js";

describe("parseMappingReason", () => {
  it("returns undefined for null input", () => {
  expect(parseMappingReason(null)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
  expect(parseMappingReason(undefined)).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
  expect(parseMappingReason("invalid json")).toBeUndefined();
  });

  it("extracts mapping_reason from routing stage", () => {
  const snapshot = JSON.stringify([
    { stage: "routing", mapping_reason: "group_schedule" },
  ]);
  expect(parseMappingReason(snapshot)).toBe("group_schedule");
  });

  it("prioritizes overflow_redirect over routing mapping_reason", () => {
  const snapshot = JSON.stringify([
    { stage: "routing", mapping_reason: "group_schedule" },
    { stage: "overflow", triggered: true },
  ]);
  expect(parseMappingReason(snapshot)).toBe("overflow_redirect");
  });

  it("returns undefined when routing stage has no mapping_reason field", () => {
  const snapshot = JSON.stringify([{ stage: "routing" }]);
  expect(parseMappingReason(snapshot)).toBeUndefined();
  });

  it("returns undefined for non-array JSON", () => {
  expect(parseMappingReason("{}")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
  expect(parseMappingReason("[]")).toBeUndefined();
  });

  it("skips overflow when triggered is false, returns routing mapping_reason", () => {
  const snapshot = JSON.stringify([
    { stage: "routing", mapping_reason: "direct_format" },
    { stage: "overflow", triggered: false },
  ]);
  expect(parseMappingReason(snapshot)).toBe("direct_format");
  });
});
