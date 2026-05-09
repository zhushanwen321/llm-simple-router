import type { Transform } from "stream";

export type ErrorKind =
  | "modelNotFound"
  | "modelNotAllowed"
  | "providerUnavailable"
  | "providerTypeMismatch"
  | "upstreamConnectionFailed"
  | "concurrencyQueueFull"
  | "concurrencyTimeout"
  | "promptTooLong";

export interface FormatAdapter {
  readonly apiType: string;
  readonly defaultPath: string;
  readonly errorMeta: Record<ErrorKind, { type: string; code: string }>;
  beforeSendProxy?(body: Record<string, unknown>, isStream: boolean): void;
  formatError(message: string, code?: string): unknown;
}

export interface FormatConverter {
  readonly sourceType: string;
  readonly targetType: string;
  transformRequest(body: Record<string, unknown>, model: string): Record<string, unknown>;
  transformResponse(bodyStr: string): string;
  createStreamTransform(model: string): Transform;
}

/** Factory: eliminates repetitive object literal structure across 6 converters. */
export function createConverter(deps: {
  sourceType: string;
  targetType: string;
  requestTransform: (body: Record<string, unknown>) => Record<string, unknown>;
  responseTransform: (bodyStr: string) => string;
  streamTransformClass: new (model: string) => Transform;
}): FormatConverter {
  return {
    sourceType: deps.sourceType,
    targetType: deps.targetType,
    transformRequest(body) {
      return deps.requestTransform(body);
    },
    transformResponse(bodyStr) {
      return deps.responseTransform(bodyStr);
    },
    createStreamTransform(model) {
      return new deps.streamTransformClass(model);
    },
  };
}
