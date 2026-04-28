import { SSEParser, type SSEEvent } from "../../metrics/sse-parser.js";

const MAX_BUFFER = 65536;

/**
 * SSEParser 子类，增加未解析缓冲区上限保护。
 * 防止畸形 SSE（无 \n\n 分隔）导致缓冲区无限增长。
 * 只检查当前未解析缓冲区大小，已消费的事件不计入。
 */
export class SafeSSEParser extends SSEParser {
  override feed(chunk: string): SSEEvent[] {
    const events = super.feed(chunk);
    if (this.bufferLength > MAX_BUFFER) {
      throw new Error(`SSE buffer exceeded ${MAX_BUFFER} bytes`);
    }
    return events;
  }
}
