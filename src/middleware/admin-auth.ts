import { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { isInitialized, getSetting } from "../db/settings.js";
import { verifyPassword } from "../utils/password.js";
import { API_CODE, apiError } from "../admin/api-response.js";

interface AdminAuthOptions {
  db: Database.Database;
}

const HTTP_UNAUTHORIZED = 401;

const adminAuthRaw: FastifyPluginCallback<AdminAuthOptions> = (app, options, done) => {
  app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];

    // Setup API 不需要 auth
    if (path.startsWith("/admin/api/setup/")) return;

    // Login/logout 不需要 auth
    if (path === "/admin/api/login" || path === "/admin/api/logout") return;

    // 非 admin API 路径跳过
    if (!path.startsWith("/admin/api/")) return;

    // 未初始化时返回 needsSetup
    if (!isInitialized(options.db)) {
      return reply.code(HTTP_UNAUTHORIZED).send(apiError(API_CODE.NOT_INITIALIZED, "Not initialized"));
    }

    const token = request.cookies["admin_token"];
    if (!token) {
      reply.code(HTTP_UNAUTHORIZED).send(apiError(API_CODE.TOKEN_INVALID, "Not authenticated"));
      return reply;
    }

    const secret = getSetting(options.db, "jwt_secret");
    try {
      jwt.verify(token, secret ?? "");
    } catch (err: unknown) {
      request.log.debug({ err }, "invalid JWT token");
      reply.code(HTTP_UNAUTHORIZED).send(apiError(API_CODE.TOKEN_INVALID, "Invalid or expired token"));
      return reply;
    }
  });

  done();
};

export const adminAuthPlugin = fp(adminAuthRaw, { name: "admin-auth" });

export const adminLoginRoutes: FastifyPluginCallback<AdminAuthOptions> = (app, options, done) => {
  const TOKEN_EXPIRY_SECONDS = 172800; // 48 hours

  app.post("/admin/api/login", async (request, reply) => {
    const { password } = request.body as { password?: string };
    if (!password) {
      return reply.code(HTTP_UNAUTHORIZED).send(apiError(API_CODE.WRONG_PASSWORD, "Invalid password"));
    }

    // DB 模式：scrypt hash 验证
    const hash = getSetting(options.db, "admin_password_hash");
    if (!hash || !verifyPassword(password, hash)) {
      return reply.code(HTTP_UNAUTHORIZED).send(apiError(API_CODE.WRONG_PASSWORD, "Invalid password"));
    }

    const secret = getSetting(options.db, "jwt_secret");
    if (!secret) {
      request.log.error("JWT secret not configured, cannot issue token");
      return reply.code(HTTP_UNAUTHORIZED).send(apiError(API_CODE.TOKEN_INVALID, "JWT secret not configured"));
    }
    const token = jwt.sign({ role: "admin" }, secret, { expiresIn: TOKEN_EXPIRY_SECONDS });
    reply.setCookie("admin_token", token, {
      path: "/admin",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TOKEN_EXPIRY_SECONDS,
    });
    return reply.send({ success: true });
  });

  app.post("/admin/api/logout", async (_request, reply) => {
    reply.clearCookie("admin_token", { path: "/admin" });
    return reply.send({ success: true });
  });

  done();
};
