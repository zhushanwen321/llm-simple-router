import { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "crypto";

interface AdminAuthOptions {
  adminPassword: string;
  jwtSecret: string;
}

const HTTP_UNAUTHORIZED = 401;

const adminAuthRaw: FastifyPluginCallback<AdminAuthOptions> = (app, options, done) => {
  app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (!path.startsWith("/admin/api/") || path === "/admin/api/login" || path === "/admin/api/logout") {
      return;
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
    const passwordBuf = Buffer.from(password);
    const keyBuf = Buffer.from(options.adminPassword);
    if (passwordBuf.length !== keyBuf.length || !timingSafeEqual(passwordBuf, keyBuf)) {
      return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: "Invalid password" } });
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
