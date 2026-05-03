import { describe, it, expect } from "vitest";
import { convertToolsOA2Ant, convertToolsAnt2OA, mapToolChoiceOA2Ant, mapToolChoiceAnt2OA } from "../../../src/proxy/transform/tool-mapper.js";

describe("tool mapping", () => {
  describe("convertToolsOA2Ant", () => {
    it("converts OA tool definitions to Ant format", () => {
      const tools = [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }];
      const result = convertToolsOA2Ant(tools);
      expect(result).toEqual([{ name: "get_weather", description: "Get weather", input_schema: { type: "object" } }]);
    });
    it("handles missing description", () => {
      const tools = [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }];
      const result = convertToolsOA2Ant(tools);
      expect(result[0].name).toBe("get_weather");
      expect(result[0].description).toBeUndefined();
    });
  });

  describe("convertToolsAnt2OA", () => {
    it("converts Ant tool definitions to OA format", () => {
      const tools = [{ name: "get_weather", description: "Get weather", input_schema: { type: "object" } }];
      const result = convertToolsAnt2OA(tools);
      expect(result).toEqual([{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }]);
    });
  });

  describe("mapToolChoiceOA2Ant", () => {
    it("auto → {type:'auto'}", () => expect(mapToolChoiceOA2Ant("auto")).toEqual({ type: "auto" }));
    it("required → {type:'any'}", () => expect(mapToolChoiceOA2Ant("required")).toEqual({ type: "any" }));
    it("none → undefined (should not send tools)", () => expect(mapToolChoiceOA2Ant("none")).toBeUndefined());
    it("{type:'function',function:{name}} → {type:'tool',name}", () => {
      expect(mapToolChoiceOA2Ant({ type: "function", function: { name: "get_weather" } })).toEqual({ type: "tool", name: "get_weather" });
    });
    it("unknown string → {type:'auto'}", () => expect(mapToolChoiceOA2Ant("something")).toEqual({ type: "auto" }));
  });

  describe("mapToolChoiceAnt2OA", () => {
    it("{type:'auto'} → 'auto'", () => expect(mapToolChoiceAnt2OA({ type: "auto" })).toBe("auto"));
    it("{type:'any'} → 'required'", () => expect(mapToolChoiceAnt2OA({ type: "any" })).toBe("required"));
    it("{type:'tool',name} → {type:'function',function:{name}}", () => {
      expect(mapToolChoiceAnt2OA({ type: "tool", name: "get_weather" })).toEqual({ type: "function", function: { name: "get_weather" } });
    });
    it("{type:'auto', disable_parallel_tool_use:true} → {type:'auto', parallel_tool_calls:false}", () => {
      const result = mapToolChoiceAnt2OA({ type: "auto", disable_parallel_tool_use: true });
      expect(result).toEqual({ type: "auto", parallel_tool_calls: false });
    });
    it("plain 'auto' string → 'auto'", () => expect(mapToolChoiceAnt2OA("auto")).toBe("auto"));
  });
});
