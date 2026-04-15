import { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { timingSafeEqual } from "crypto";
import fp from "fastify-plugin";

const SKIP_PATHS = ["/health", "/admin"];
const HTTP_UNAUTHORIZED = 401;
const BEARER_PREFIX_LENGTH = "Bearer ".length;

function shouldSkipAuth(url: string): boolean {
  // url 可能包含查询字符串，只取路径部分
  const path = url.split("?")[0];
  return SKIP_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/")
  );
}

function unauthorizedReply(reply: FastifyReply): void {
  reply.code(HTTP_UNAUTHORIZED).send({
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

    const token = authHeader.slice(BEARER_PREFIX_LENGTH);
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(options.apiKey);
    if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
      unauthorizedReply(reply);
      return reply;
    }
  });

  done();
};

// 用 fp 包装以打破 Fastify 的封装，使 hook 作用于全局
export const authMiddleware = fp(authMiddlewareRaw, { name: "auth-middleware" });
