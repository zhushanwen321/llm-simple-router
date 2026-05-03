import { extractStreamText } from "./stream-extractor.js";
import type { StreamContentSnapshot, ContentBlock } from "./types.js";

export const DEFAULT_MAX_RAW = 131072;
export const DEFAULT_MAX_TEXT = 65536;

export class StreamContentAccumulator {
  private rawChunks = "";
  private textContent = "";
  private totalChars = 0;
  private blocks: ContentBlock[] = [];

  constructor(
    private readonly maxRaw: number = DEFAULT_MAX_RAW,
    private readonly maxText: number = DEFAULT_MAX_TEXT,
  ) {}

  append(rawLine: string, apiType: "openai" | "openai-responses" | "anthropic"): void {
    this.totalChars += rawLine.length;

    this.rawChunks += rawLine + "\n";
    if (this.rawChunks.length > this.maxRaw) {
      this.rawChunks = this.rawChunks.slice(-this.maxRaw);
    }

    const extracted = extractStreamText(rawLine, apiType);

    if (extracted.text) {
      this.textContent += extracted.text;
      if (this.textContent.length > this.maxText) {
        this.textContent = this.textContent.slice(-this.maxText);
      }
    }

    if (extracted.block) {
      const { index, type, content, name } = extracted.block;
      while (this.blocks.length <= index) {
        this.blocks.push({ type: "text", content: "" });
      }
      if (name) {
        this.blocks[index].name = name;
      }
      if (content === "" && type !== "text") {
        this.blocks[index].type = type;
      } else if (content) {
        this.blocks[index].content += content;
        this.blocks[index].type = type;
      }
      for (const block of this.blocks) {
        if (block.content.length > this.maxText) {
          block.content = block.content.slice(-this.maxText);
        }
      }
    }
  }

  getSnapshot(): StreamContentSnapshot {
    return {
      rawChunks: this.rawChunks,
      textContent: this.textContent,
      totalChars: this.totalChars,
      blocks: this.blocks.length > 0 ? this.blocks : undefined,
    };
  }
}
