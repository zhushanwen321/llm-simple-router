import { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { isInitialized, getSetting } from "../db/settings.js";
import { verifyPassword } from "../utils/password.js";
import { isForwardedProtoHttps } from "../utils/cookie-secure.js";
import { API_CODE, apiError } from "../admin/api-response.js";

interface AdminAuthOptions {
  db: Database.Database;
}

const HTTP_UNAUTHORIZED = 401;

// DEV_SKIP_AUTH=1 时跳过 admin token 校验，但仅放行 loopback 来源的请求。
// 用途：本地开发时免登录。仅作用于 admin API，不影响 router_keys 代理认证。
// 不签 cookie、不写 DB、不调 setup；未初始化时仍需人工走 setup 流程。
// 每次请求时读取 env，便于测试时切换；生产环境绝不允许启用。
function isDevSkipAuthEnabled(): boolean {
  return process.env.DEV_SKIP_AUTH === "1";
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  // Node dual-stack 下 IPv4 客户端可能得到 "::ffff:127.0.0.1"
  const IPV4_MAPPED_PREFIX = "::ffff:";
  const IPV4_MAPPED_PREFIX_LENGTH = IPV4_MAPPED_PREFIX.length;
  const normalized = ip.startsWith(IPV4_MAPPED_PREFIX)
    ? ip.slice(IPV4_MAPPED_PREFIX_LENGTH)
    : ip;
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

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

    // Dev 模式：仅放行 loopback 访问的 admin API
    if (isDevSkipAuthEnabled()) {
      if (!isLoopbackIp(request.ip)) {
        return reply
          .code(HTTP_UNAUTHORIZED)
          .send(apiError(API_CODE.TOKEN_INVALID, "DEV_SKIP_AUTH requires loopback access"));
      }
      return;
    }

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
      secure: request.protocol === "https" || isForwardedProtoHttps(request),
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
