// router/src/proxy/pipeline/context.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PipelineContext } from "./types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";

export function createPipelineContext(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: string,
): PipelineContext {
  const body = request.body as Record<string, unknown>;
  const clientModel = (body.model as string) || "unknown";
  const rawBody = body ? structuredClone(body) : {};

  return {
    request,
    reply,
    rawBody,
    clientModel,
    apiType,
    body,
    isStream: body.stream === true,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: apiType,
    injectedHeaders: {},
    metadata: new Map(),
    logId: "",
    rootLogId: null,
    transportResult: null,
    resilienceResult: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: new PipelineSnapshot(),
  };
}
