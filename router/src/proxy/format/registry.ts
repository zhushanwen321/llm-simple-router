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

  transformResponse(bodyStr: string, source: string, target: string): string {
    const converter = this.converters.get(`${source}→${target}`);
    if (!converter) return bodyStr;
    return converter.transformResponse(bodyStr);
  }

  transformError(bodyStr: string, source: string, target: string): string {
    if (source === target) return bodyStr;
    try {
      const parsed = JSON.parse(bodyStr);
      const message =
        parsed.error?.message ?? parsed.message ?? JSON.stringify(parsed);
      const code = parsed.error?.code ?? parsed.code;
      const targetAdapter = this.adapters.get(target);
      if (!targetAdapter) return bodyStr;
      return JSON.stringify(targetAdapter.formatError(message, code));
    } catch {
      return bodyStr;
    }
  }

  createStreamTransform(source: string, target: string, model: string): Transform | undefined {
    const converter = this.converters.get(`${source}→${target}`);
    return converter?.createStreamTransform(model);
  }
}
