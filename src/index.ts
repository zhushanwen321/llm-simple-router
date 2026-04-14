import Fastify from "fastify";
import { getConfig } from "./config.js";

async function main() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  app.get("/health", async () => {
    return { status: "ok" };
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
