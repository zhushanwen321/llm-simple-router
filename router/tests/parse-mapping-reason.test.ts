import { describe, it, expect } from "vitest";

/**
 * parseMappingReason: 从 pipeline_snapshot JSON 中提取映射原因。
 * 此函数与前端实现完全一致，用于后端单元测试。
 */
function parseMappingReason(snapshot: string | null | undefined): string | undefined {
  if (!snapshot) return undefined;
  try {
  const parsed: unknown = JSON.parse(snapshot);
  const stages: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [];
  if (stages.length === 0) return undefined;
  for (const stage of stages) {
    if (stage.stage === "overflow" && stage.triggered === true) {
    return "overflow_redirect";
    }
  }
  for (const stage of stages) {
    if (stage.stage === "routing" && typeof stage.mapping_reason === "string") {
    return stage.mapping_reason;
    }
  }
  return undefined;
  } catch {
  return undefined;
  }
}

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
  const snapshot = JSON.stringify([
    { stage: "routing" },
  ]);
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
