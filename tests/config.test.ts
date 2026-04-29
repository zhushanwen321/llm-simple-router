import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, getBaseConfig, resetConfig } from "../src/config/index.js";

describe("config", () => {
  beforeEach(() => {
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.TZ;
    delete process.env.STREAM_TIMEOUT_MS;
    delete process.env.RETRY_BASE_DELAY_MS;
    resetConfig();
  });

  it("should return defaults when env vars are not set", () => {
    const config = getBaseConfig();

    expect(config.PORT).toBe(9981);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.TZ).toBe("Asia/Shanghai");
    expect(config.STREAM_TIMEOUT_MS).toBe(3000000);
    expect(config.RETRY_BASE_DELAY_MS).toBe(1000);
  });

  it("should parse PORT as number", () => {
    process.env.PORT = "8080";
    resetConfig();

    const config = getConfig();
    expect(config.PORT).toBe(8080);
  });

  it("should return cached config on subsequent calls", () => {
    const config1 = getConfig();
    process.env.PORT = "9999";
    const config2 = getConfig();
    expect(config1).toBe(config2);
    expect(config2.PORT).toBe(9981);
  });
});
