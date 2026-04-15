import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/utils/crypto.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  it("should encrypt and decrypt back to original text", () => {
    const plaintext = "sk-my-secret-api-key";
    const encrypted = encrypt(plaintext, KEY);
    const decrypted = decrypt(encrypted, KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertext each time (random IV)", () => {
    const plaintext = "same-text";
    const enc1 = encrypt(plaintext, KEY);
    const enc2 = encrypt(plaintext, KEY);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1, KEY)).toBe(plaintext);
    expect(decrypt(enc2, KEY)).toBe(plaintext);
  });

  it("should return hex formatted string with two colons", () => {
    const encrypted = encrypt("hello", KEY);
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    for (const part of parts) {
      expect(/^[0-9a-f]+$/.test(part)).toBe(true);
    }
  });

  it("should throw on wrong key", () => {
    const encrypted = encrypt("secret", KEY);
    const wrongKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("should throw on tampered ciphertext", () => {
    const encrypted = encrypt("secret", KEY);
    const parts = encrypted.split(":");
    // XOR 首字节，保证密文一定被篡改
    const buf = Buffer.from(parts[2], "hex");
    buf[0] = buf[0] ^ 0xff;
    parts[2] = buf.toString("hex");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("should handle empty string", () => {
    const encrypted = encrypt("", KEY);
    const decrypted = decrypt(encrypted, KEY);
    expect(decrypted).toBe("");
  });

  it("should handle unicode text", () => {
    const plaintext = "你好世界 API-KEY-中文测试 🔑";
    const encrypted = encrypt(plaintext, KEY);
    const decrypted = decrypt(encrypted, KEY);
    expect(decrypted).toBe(plaintext);
  });
});
