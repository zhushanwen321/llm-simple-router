import { FastifyInstance, FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";

const SKIP_PATHS = ["/health", "/admin"];

function shouldSkipAuth(url: string): boolean {
  // url 可能包含查询字符串，只取路径部分
  const path = url.split("?")[0];
  return SKIP_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/")
  );
}

function unauthorizedReply(reply: any): void {
  reply.code(401).send({
    error: {
      message: "Invalid API key",
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  });
}

const authMiddlewareRaw: FastifyPluginCallback<{ apiKey: string }> = (
  app: FastifyInstance,
  options,
  done
) => {
  app.addHook("onRequest", async (request, reply) => {
    if (shouldSkipAuth(request.url)) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      unauthorizedReply(reply);
      return reply;
    }

    const token = authHeader.slice(7);
    if (token !== options.apiKey) {
      unauthorizedReply(reply);
      return reply;
    }
  });

  done();
};

// 用 fp 包装以打破 Fastify 的封装，使 hook 作用于全局
export const authMiddleware = fp(authMiddlewareRaw, { name: "auth-middleware" });
