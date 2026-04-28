import { SSEParser, type SSEEvent } from "../../metrics/sse-parser.js";

const MAX_TOTAL = 65536;

/**
 * SSEParser 子类，增加累积字节数上限保护。
 * 防止畸形 SSE（无 \n\n 分隔）导致缓冲区无限增长。
 */
export class SafeSSEParser extends SSEParser {
  private totalFed = 0;

  override feed(chunk: string): SSEEvent[] {
    this.totalFed += chunk.length;
    if (this.totalFed > MAX_TOTAL) {
      this.totalFed = 0;
      throw new Error(`SSE buffer exceeded ${MAX_TOTAL} bytes`);
    }
    return super.feed(chunk);
  }
}
