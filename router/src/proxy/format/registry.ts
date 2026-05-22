import type { Transform } from "stream";
import type { FormatAdapter, FormatConverter } from "./types.js";

/**
 * ConverterRegistry — 双层注册表的下层。
 * 按 `sourceApiType→targetApiType` 注册和查询 FormatConverter。
 */
export class ConverterRegistry {
  private converters = new Map<string, FormatConverter>();

  /** 注册一个转换器，key 为 "source→target" */
  registerConverter(converter: FormatConverter): void {
    this.converters.set(`${converter.sourceType}→${converter.targetType}`, converter);
  }

  /** 获取指定方向的转换器 */
  getConverter(source: string, target: string): FormatConverter | undefined {
    return this.converters.get(`${source}→${target}`);
  }

  /** 检查是否需要格式转换（source≠target 时认为需要） */
  needsTransform(source: string, target: string): boolean {
    return source !== target;
  }
}

/**
 * FormatRegistry — 双层注册表的顶层。
 * - AdapterRegistry 职责：按 apiType 注册 FormatAdapter（获取 defaultPath、错误格式化）
 * - ConverterRegistry 职责：按 source→target 注册 FormatConverter（请求/响应/流转换）
 *
 * 保持与单层注册表相同的 public API，内部将转换器逻辑委托给 ConverterRegistry。
 */
export class FormatRegistry {
  private adapters = new Map<string, FormatAdapter>();
  private converterRegistry = new ConverterRegistry();

  /** 注册 adapter */
  registerAdapter(adapter: FormatAdapter): void {
    this.adapters.set(adapter.apiType, adapter);
  }

  /** 注册 converter，委托给 ConverterRegistry */
  registerConverter(converter: FormatConverter): void {
    this.converterRegistry.registerConverter(converter);
  }

  /** 获取 ConverterRegistry（用于高级场景：批量查询、直接访问） */
  getConverterRegistry(): ConverterRegistry {
    return this.converterRegistry;
  }

  getAdapter(apiType: string): FormatAdapter | undefined {
    return this.adapters.get(apiType);
  }

  needsTransform(source: string, target: string): boolean {
    return this.converterRegistry.needsTransform(source, target);
  }

  transformRequest(
    body: Record<string, unknown>,
    source: string,
    target: string,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string } {
    const targetAdapter = this.adapters.get(target);
    const upstreamPath = targetAdapter?.defaultPath ?? "/v1/chat/completions";
    const converter = this.converterRegistry.getConverter(source, target);
    if (!converter) return { body, upstreamPath };
    return { body: converter.transformRequest(body, model), upstreamPath };
  }

  transformResponse(body: Record<string, unknown>, source: string, target: string): Record<string, unknown> {
    const converter = this.converterRegistry.getConverter(source, target);
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
    const converter = this.converterRegistry.getConverter(source, target);
    return converter?.createStreamTransform(model);
  }
}
