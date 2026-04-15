import { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";

interface AdminAuthOptions {
  adminPassword: string;
}

const adminAuthRaw: FastifyPluginCallback<AdminAuthOptions> = (app, options, done) => {
  app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (!path.startsWith("/admin/api/") || path === "/admin/api/login" || path === "/admin/api/logout") {
      return;
    }

    const token = request.cookies["admin_token"];
    if (!token) {
      reply.code(401).send({ error: { message: "Not authenticated" } });
      return reply;
    }

    try {
      jwt.verify(token, options.adminPassword);
    } catch {
      reply.code(401).send({ error: { message: "Invalid or expired token" } });
      return reply;
    }
  });

  done();
};

export const adminAuthPlugin = fp(adminAuthRaw, { name: "admin-auth" });

export const adminLoginRoutes: FastifyPluginCallback<AdminAuthOptions> = (app, options, done) => {
  app.post("/admin/api/login", async (request, reply) => {
    const { password } = request.body as { password?: string };
    if (!password || password !== options.adminPassword) {
      return reply.code(401).send({ error: { message: "Invalid password" } });
    }

    const token = jwt.sign({ role: "admin" }, options.adminPassword, { expiresIn: "24h" });
    reply.setCookie("admin_token", token, {
      path: "/admin",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 86400,
    });
    return reply.send({ success: true });
  });

  app.post("/admin/api/logout", async (_request, reply) => {
    reply.clearCookie("admin_token", { path: "/admin" });
    return reply.send({ success: true });
  });

  done();
};
