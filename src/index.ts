import Fastify from "fastify";
import { getConfig } from "./config.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";

async function main() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // 注册认证中间件
  app.register(authMiddleware, { apiKey: config.ROUTER_API_KEY });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  // 注册 OpenAI 代理路由
  // TODO: Task 6 中注入 db via options
  app.register(openaiProxy, {
    db: /* Task 6 注入 */ null as any,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });

  // 注册 Anthropic 代理路由
  app.register(anthropicProxy, {
    db: /* Task 6 注入 */ null as any,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
