import type { Transform } from "stream";
import type { FormatAdapter, FormatConverter } from "./types.js";

export class FormatRegistry {
  private adapters = new Map<string, FormatAdapter>();
  private converters = new Map<string, FormatConverter>();

  registerAdapter(adapter: FormatAdapter): void {
    this.adapters.set(adapter.apiType, adapter);
  }

  registerConverter(converter: FormatConverter): void {
    this.converters.set(`${converter.sourceType}→${converter.targetType}`, converter);
  }

  getAdapter(apiType: string): FormatAdapter | undefined {
    return this.adapters.get(apiType);
  }

  needsTransform(source: string, target: string): boolean {
    return source !== target;
  }

  transformRequest(
    body: Record<string, unknown>,
    source: string,
    target: string,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string } {
    const targetAdapter = this.adapters.get(target);
    const upstreamPath = targetAdapter?.defaultPath ?? "/v1/chat/completions";
    const converter = this.converters.get(`${source}→${target}`);
    if (!converter) return { body, upstreamPath };
    return { body: converter.transformRequest(body, model), upstreamPath };
  }

  transformResponse(body: Record<string, unknown>, source: string, target: string): Record<string, unknown> {
    const converter = this.converters.get(`${source}→${target}`);
    if (!converter) return body;
    return converter.transformResponse(body);
  }

  transformError(body: Record<string, unknown>, source: string, target: string): string {
    if (source === target) return JSON.stringify(body);
    try {
      const message =
    (body.error as Record<string, unknown> | undefined)?.message as string ?? body.message as string ?? JSON.stringify(body);
      const code = (body.error as Record<string, unknown> | undefined)?.code as string ?? body.code as string;
      const targetAdapter = this.adapters.get(target);
      if (!targetAdapter) return JSON.stringify(body);
      return JSON.stringify(targetAdapter.formatError(message, code));
    } catch {
      return JSON.stringify(body);
    }
  }

  createStreamTransform(source: string, target: string, model: string): Transform | undefined {
    const converter = this.converters.get(`${source}→${target}`);
    return converter?.createStreamTransform(model);
  }
}
