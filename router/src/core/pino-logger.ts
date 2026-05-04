import type { Logger } from "@llm-router/core";
import type { FastifyBaseLogger } from "fastify";

/** Adapt fastify/pino logger to core Logger interface. */
export function adaptLogger(log: FastifyBaseLogger): Logger {
  return {
    debug: (obj, msg) => log.debug(obj, msg),
    warn: (obj, msg) => log.warn(obj, msg),
    error: (obj, msg) => log.error(obj, msg),
  };
}
