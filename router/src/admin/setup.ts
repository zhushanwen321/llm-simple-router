import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { getSetting, setSetting, isInitialized } from "../db/settings.js";
import { hashPassword } from "../utils/password.js";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

const CRYPTO_BYTES_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 6;

interface SetupOptions {
  db: Database.Database;
}

export const adminSetupRoutes: FastifyPluginCallback<SetupOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/setup/status", async () => {
    return { initialized: isInitialized(db) };
  });

  app.post("/admin/api/setup/initialize", async (request, reply) => {
    const { password } = request.body as { password?: string };
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.VALIDATION_FAILED, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`));
    }

    // 事务中原子检查防竞态
    const alreadyInitialized = db.transaction(() => {
      if (isInitialized(db)) return true;
      const encryptionKey = randomBytes(CRYPTO_BYTES_LENGTH).toString("hex");
      const jwtSecret = randomBytes(CRYPTO_BYTES_LENGTH).toString("hex");
      setSetting(db, "admin_password_hash", hashPassword(password));
      setSetting(db, "encryption_key", encryptionKey);
      setSetting(db, "jwt_secret", jwtSecret);
      setSetting(db, "initialized", "true");
      return false;
    })();

    if (alreadyInitialized) {
      return reply.code(HTTP_CONFLICT).send(apiError(API_CODE.ALREADY_INITIALIZED, "Already initialized"));
    }

    // 自动登录：签发 JWT
    const TOKEN_EXPIRY_SECONDS = 172800; // 48 hours，与 admin-auth 保持一致
    const secret = getSetting(db, "jwt_secret");
    const token = jwt.sign({ role: "admin" }, secret!, { expiresIn: TOKEN_EXPIRY_SECONDS });
    reply.setCookie("admin_token", token, {
      path: "/admin",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TOKEN_EXPIRY_SECONDS,
    });

    return { success: true };
  });

  done();
};
