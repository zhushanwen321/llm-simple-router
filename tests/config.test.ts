import { describe, it, expect, beforeEach } from "vitest";

describe("getConfig", () => {
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
  });

  it("should throw when required env vars are missing", async () => {
    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;

    delete process.env.ADMIN_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;

    resetConfig();

    expect(() => getConfig()).toThrow("ADMIN_PASSWORD");
  });

  it("should return config with defaults when required vars are set", async () => {
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.JWT_SECRET = "0".repeat(64);

    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    const config = getConfig();

    expect(config.ADMIN_PASSWORD).toBe("admin123");
    expect(config.PORT).toBe(3000);
    expect(config.DB_PATH).toBe("./data/router.db");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.TZ).toBe("Asia/Shanghai");
    expect(config.STREAM_TIMEOUT_MS).toBe(3000000);
    expect(config.RETRY_MAX_ATTEMPTS).toBe(3);
    expect(config.RETRY_BASE_DELAY_MS).toBe(1000);
  });

  it("should parse PORT as number", async () => {
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.JWT_SECRET = "0".repeat(64);
    process.env.PORT = "8080";

    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    const config = getConfig();
    expect(config.PORT).toBe(8080);
  });

  it("should return cached config on subsequent calls", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.JWT_SECRET = "a".repeat(64);

    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    const config1 = getConfig();
    process.env.ADMIN_PASSWORD = "different";
    const config2 = getConfig();
    expect(config1).toBe(config2);
    expect(config2.ADMIN_PASSWORD).toBe("pw");
  });
});
