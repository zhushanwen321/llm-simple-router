import type { FastifyReply } from "fastify";

export const HTTP_BAD_REQUEST = 400;
export const HTTP_CREATED = 201;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_INTERNAL_ERROR = 500;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_SERVICE_UNAVAILABLE = 503;

export function sendErrorResponse(reply: FastifyReply, statusCode: number, message: string) {
  return reply.code(statusCode).send({ error: { message } });
}
