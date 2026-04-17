import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, getBaseConfig, resetConfig } from "../src/config.js";

describe("config", () => {
  beforeEach(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.TZ;
    delete process.env.STREAM_TIMEOUT_MS;
    delete process.env.RETRY_MAX_ATTEMPTS;
    delete process.env.RETRY_BASE_DELAY_MS;
    resetConfig();
  });

  it("should not throw when required env vars are missing (zero-config)", () => {
    const config = getBaseConfig();
    expect(config.ADMIN_PASSWORD).toBe("");
    expect(config.ENCRYPTION_KEY).toBe("");
    expect(config.JWT_SECRET).toBe("");
    expect(config.needsSetup).toBe(false);
  });

  it("should return config with defaults when required vars are set", () => {
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.JWT_SECRET = "0".repeat(64);
    resetConfig();

    const config = getConfig();

    expect(config.ADMIN_PASSWORD).toBe("admin123");
    expect(config.PORT).toBe(9981);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.STREAM_TIMEOUT_MS).toBe(3000000);
  });

  it("should parse PORT as number", () => {
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.JWT_SECRET = "0".repeat(64);
    process.env.PORT = "8080";
    resetConfig();

    const config = getConfig();
    expect(config.PORT).toBe(8080);
  });

  it("should return cached config on subsequent calls", () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.JWT_SECRET = "a".repeat(64);
    resetConfig();

    const config1 = getConfig();
    process.env.ADMIN_PASSWORD = "different";
    const config2 = getConfig();
    expect(config1).toBe(config2);
    expect(config2.ADMIN_PASSWORD).toBe("pw");
  });
});
