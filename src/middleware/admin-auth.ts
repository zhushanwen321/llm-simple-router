import { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "crypto";
import Database from "better-sqlite3";
import { isInitialized, getSetting } from "../db/settings.js";
import { verifyPassword } from "../utils/password.js";

interface AdminAuthOptions {
  adminPassword: string;
  jwtSecret: string;
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

    // 未初始化时，除了 setup 以外的 API 返回 needsSetup
    // 环境变量提供了所有 secrets 则视为已初始化
    const envReady = options.adminPassword && options.jwtSecret;
    if (!envReady && !isInitialized(options.db)) {
      return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Not initialized", needsSetup: true } });
    }

    const token = request.cookies["admin_token"];
    if (!token) {
      reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Not authenticated" } });
      return reply;
    }

    try {
      jwt.verify(token, options.jwtSecret);
    } catch (err: unknown) {
      request.log.debug({ err }, "invalid JWT token");
      reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Invalid or expired token" } });
      return reply;
    }
  });

  done();
};

export const adminAuthPlugin = fp(adminAuthRaw, { name: "admin-auth" });

export const adminLoginRoutes: FastifyPluginCallback<AdminAuthOptions> = (app, options, done) => {
  const TOKEN_EXPIRY_SECONDS = 86400;

  app.post("/admin/api/login", async (request, reply) => {
    const { password } = request.body as { password?: string };
    if (!password) {
      return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Invalid password" } });
    }

    // 环境变量/配置模式：明文 timing-safe 对比（非 __DB_AUTH__ 占位值）
    const configuredPassword = options.adminPassword;
    if (configuredPassword && configuredPassword !== "__DB_AUTH__") {
      const passwordBuf = Buffer.from(password);
      const keyBuf = Buffer.from(configuredPassword);
      if (passwordBuf.length !== keyBuf.length || !timingSafeEqual(passwordBuf, keyBuf)) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Invalid password" } });
      }
    } else {
      // DB 模式：scrypt hash 验证
      const hash = getSetting(options.db, "admin_password_hash");
      if (!hash || !verifyPassword(password, hash)) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Invalid password" } });
      }
    }

    const token = jwt.sign({ role: "admin" }, options.jwtSecret, { expiresIn: TOKEN_EXPIRY_SECONDS });
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
