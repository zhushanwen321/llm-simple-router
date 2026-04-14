import Fastify, { FastifyInstance } from "fastify";
import { getConfig, Config } from "./config.js";
import { initDatabase } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";
import { adminRoutes } from "./admin/routes.js";
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
  });

  app.register(authMiddleware, { apiKey: config.ROUTER_API_KEY });
  app.register(openaiProxy, {
    db,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });
  app.register(anthropicProxy, {
    db,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });

  app.register(adminRoutes, {
    db,
    adminPassword: config.ADMIN_PASSWORD,
    encryptionKey: config.ENCRYPTION_KEY,
  });

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

const isMainModule = process.argv[1]?.endsWith("index.js");
if (isMainModule) {
  main();
}
