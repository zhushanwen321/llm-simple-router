import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify, { FastifyInstance } from "fastify";

const HTTP_NOT_FOUND = 404;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getConfig, Config } from "./config.js";
import { initDatabase, seedDefaultRules } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";
import { adminRoutes } from "./admin/routes.js";
import { RetryRuleMatcher } from "./proxy/retry-rules.js";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";

export interface AppOptions {
  config?: Config;
  db?: Database.Database;
}

export async function buildApp(
  options?: AppOptions
): Promise<{
  app: FastifyInstance;
  db: Database.Database;
  close: () => Promise<void>;
}> {
  const config = options?.config ?? getConfig();

  // 允许外部传入已初始化的 DB（测试用），否则自行创建
  let db: Database.Database;
  if (options?.db) {
    db = options.db;
  } else {
    db = initDatabase(config.DB_PATH);
  }

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    // 统一 schema validation 错误格式为 { error: { message } }
    ajv: {
      customOptions: {
        messages: true,
      },
    },
  });

  app.setSchemaErrorFormatter((errors) => {
    const message = errors
      .map((e) => {
        const field = e.instancePath ? e.instancePath.slice(1) : e.params?.missingProperty ?? "field";
        return `${field} ${e.message}`;
      })
      .join("; ");
    return new Error(message);
  });

  // 统一 schema validation 错误响应格式
  app.setErrorHandler((error: Error, _request, reply) => {
    const fastifyError = error as Error & { statusCode?: number; validation?: unknown[] };
    const status = fastifyError.statusCode ?? 500;
    if (status === 400 && fastifyError.validation) {
      return reply.code(400).send({ error: { message: fastifyError.message } });
    }
    return reply.code(status).send({ error: { message: fastifyError.message } });
  });

  // 首次启动时插入默认重试规则（表为空时）
  seedDefaultRules(db);
  const matcher = new RetryRuleMatcher();
  matcher.load(db);

  app.register(authMiddleware, { db });
  app.register(openaiProxy, {
    db,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
    retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    matcher,
  });
  app.register(anthropicProxy, {
    db,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
    retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    matcher,
  });

  app.register(adminRoutes, {
    db,
    adminPassword: config.ADMIN_PASSWORD,
    jwtSecret: config.JWT_SECRET,
    encryptionKey: config.ENCRYPTION_KEY,
    matcher,
  });

  // 前端静态文件服务（生产环境）
  const frontendDist = path.resolve(
    process.env.FRONTEND_DIST || path.join(__dirname, "../frontend-dist")
  );

  if (existsSync(frontendDist)) {
    app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/admin/",
      wildcard: false,
    });

    // SPA fallback: /admin/ 下非 API 路径返回 index.html
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith("/admin") &&
        !request.url.startsWith("/admin/api")
      ) {
        return reply.sendFile("index.html");
      }
      reply.code(HTTP_NOT_FOUND).send({ error: "Not Found" });
    });
  } else {
    app.log.warn(
      `Frontend dist not found at ${frontendDist}, skipping static serving`
    );
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  return {
    app,
    db,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

async function main() {
  const { app } = await buildApp();
  const config = getConfig();

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMainModule) {
  main();
}
