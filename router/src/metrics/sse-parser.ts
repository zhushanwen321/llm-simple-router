/**
 * SSE 行缓冲解析器
 *
 * 将 TCP 流中分片的文本块按 SSE 协议解析为结构化事件。
 * 不是 Transform stream，而是纯解析类，由上层 Transform 调用。
 */
export interface SSEEvent {
  event?: string;
  data?: string;
}

export class SSEParser {
  private buffer = "";
  isDone = false;

  /** 当前未解析缓冲区长度，子类可据此做内存保护 */
  get bufferLength(): number {
    return this.buffer.length;
  }

  feed(chunk: string): SSEEvent[] {
    if (this.isDone) return [];
    this.buffer += chunk;
    // SSE 规范允许 \\r\\n 行尾，统一为 \\n
    // 绝大多数 chunk 不含 \\r，跳过全局 replace
    if (this.buffer.includes('\r')) {
      this.buffer = this.buffer.replace(/\r\n/g, "\n");
    }
    return this.drainEvents();
  }

  flush(): SSEEvent[] {
    const events = this.drainEvents();
    // 末尾没有 \n\n 的残余数据也尝试解析
    if (this.buffer.trim()) {
      const event = this.parseBlock(this.buffer);
      if (event) events.push(event);
    }
    this.buffer = "";
    return events;
  }

  private drainEvents(): SSEEvent[] {
    const events: SSEEvent[] = [];
    // SSE 事件块以 \n\n 分隔
    while (true) {
      const idx = this.buffer.indexOf("\n\n");
      if (idx === -1) break;

      const block = this.buffer.slice(0, idx);
      // +2 跳过 "\n\n" 分隔符
      this.buffer = this.buffer.slice(idx + "\n\n".length);

      const event = this.parseBlock(block);
      if (event) events.push(event);
      if (this.isDone) break;
    }
    return events;
  }

  private parseBlock(block: string): SSEEvent | null {
    const lines = block.split("\n");
    let eventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      // 空行在 block 内部忽略（block 边界已由 \n\n 处理）
      if (line === "") continue;
      // SSE 注释行
      if (line.startsWith(":")) continue;

      if (line.startsWith("event:")) {
        eventType = this.extractFieldValue(line);
      } else if (line.startsWith("data:")) {
        const value = this.extractFieldValue(line);
        // [DONE] 是流结束信号，不作为普通事件返回
        if (value === "[DONE]") {
          this.isDone = true;
          return null;
        }
        dataLines.push(value);
      }
      // 其他 field（id:, retry:, etc.）按 SSE 规范忽略
    }

    // 没有 data 的事件块无意义
    if (dataLines.length === 0) return null;

    return {
      event: eventType,
      data: dataLines.join("\n"),
    };
  }

  /** 提取 field 冒号后的值，去除首个空格（SSE 规范: "data: value" -> "value"） */
  private extractFieldValue(line: string): string {
    const colonIdx = line.indexOf(":");
    let value = line.slice(colonIdx + 1);
    // 第一个字符是空格时去除
    if (value.startsWith(" ")) value = value.slice(1);
    return value;
  }
}
