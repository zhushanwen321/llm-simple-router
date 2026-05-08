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
  transformRequest(
    body: Record<string, unknown>,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string };
  transformResponse(bodyStr: string): string;
  createStreamTransform(model: string): Transform;
}
