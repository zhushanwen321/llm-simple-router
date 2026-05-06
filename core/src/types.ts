/** Generic logger interface for core package decoupling from pino/fastify. */
export interface Logger {
  debug?(obj: Record<string, unknown>, msg: string): void;
  info?(obj: Record<string, unknown>, msg: string): void;
  warn?(obj: Record<string, unknown>, msg: string): void;
  error?(obj: Record<string, unknown>, msg: string): void;
}
