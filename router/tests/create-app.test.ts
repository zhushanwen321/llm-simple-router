import { describe, it, expect } from "vitest";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import Database from "better-sqlite3";

describe("BG1: buildApp split", () => {
  it("returns valid app structure with in-memory DB", async () => {
    const result = await buildApp();
    expect(result).toHaveProperty("app");
    expect(result).toHaveProperty("db");
    expect(result).toHaveProperty("usageWindowTracker");
    expect(result).toHaveProperty("tracker");
    expect(result).toHaveProperty("close");
    expect(result.app).toBeDefined();

    // /health 端点
    const res = await result.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });

    await result.close();
  });

  it("accepts external db option", async () => {
    const db = initDatabase(":memory:") as Database.Database;
    const result = await buildApp({ db });
    expect(result).toHaveProperty("app");

    const res = await result.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);

    await result.close();
  });
});
