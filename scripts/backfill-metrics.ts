/**
 * 一键回填历史请求日志和 metrics 数据：
 * 1. input_tokens 为 null/0 时，从 client_request 使用 gpt-tokenizer 估算并标记为 estimated
 * 2. 流式响应有 stream_text_content 时，重新计算 TPS（tokenizer 精确统计 text-only tokens）
 */
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { countTokens } from "../src/utils/token-counter.js";

const MS_PER_SECOND = 1000;

function parseClientRequest(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // client_request 存储格式: { headers: {...}, body: { messages: [...] } }
    if (parsed.body && typeof parsed.body === "object") {
      return parsed.body as Record<string, unknown>;
    }
    return parsed;
  } catch {
    return null;
  }
}

type ContentBlock = { type: string; text?: string; content?: unknown; input?: unknown };

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock =>
      typeof block === "object" && block !== null && "type" in block
    )
    .map(block => {
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "tool_result") {
        if (typeof block.content === "string") return block.content;
        if (Array.isArray(block.content)) return extractTextFromContent(block.content);
      }
      if (block.type === "tool_use" && typeof block.input === "object" && block.input !== null) {
        return JSON.stringify(block.input);
      }
      return "";
    })
    .join(" ");
}

function extractAllText(body: Record<string, unknown>): string {
  const parts: string[] = [];
  const messages = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      parts.push(extractTextFromContent(msg.content));
    }
  }
  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    parts.push(extractTextFromContent(body.system));
  }
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      const t = tool as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      if (fn) {
        parts.push((fn.name as string) ?? "");
        parts.push((fn.description as string) ?? "");
        if (fn.parameters) parts.push(JSON.stringify(fn.parameters));
      } else if (t.name) {
        parts.push(t.name as string);
        if (t.description) parts.push(t.description as string);
        if (t.input_schema) parts.push(JSON.stringify(t.input_schema));
      }
    }
  }
  return parts.join(" ");
}

/** 从 stream_text_content（完整 Anthropic/OpenAI 响应 JSON）中提取纯文本内容 */
function extractTextFromStreamContent(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // OpenAI 格式: { choices: [{ message: { content: "..." } }] }
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices.length > 0) {
      const msg = choices[0].message as Record<string, unknown> | undefined;
      if (msg && typeof msg.content === "string") return msg.content;
      const delta = choices[0].delta as Record<string, unknown> | undefined;
      if (delta && typeof delta.content === "string") return delta.content;
    }
    // Anthropic 格式: { content: [{ type: "text", text: "..." }, { type: "tool_use", ... }] }
    const content = parsed.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      return content
        .filter(b => b.type === "text" && typeof b.text === "string")
        .map(b => b.text as string)
        .join(" ");
    }
    return "";
  } catch {
    return "";
  }
}

interface LogRow {
  id: string;
  client_request: string | null;
  stream_text_content: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tokens_per_second: number | null;
  ttft_ms: number | null;
  latency_ms: number | null;
  is_stream: number;
  metrics_complete: number;
}

function main(): void {
  const dbPath = process.env.DB_PATH || process.argv[2];
  if (!dbPath) {
    console.error("Usage: DB_PATH=<path> npx tsx scripts/backfill-metrics.ts");
    console.error("   or: npx tsx scripts/backfill-metrics.ts <db_path>");
    process.exit(1);
  }
  if (!existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  console.log(`Opening database: ${dbPath}`);

  // 1. Backfill input_tokens
  console.log("\n=== Backfilling input_tokens ===");
  const inputCandidates = db.prepare(`
    SELECT id, client_request, input_tokens, metrics_complete
    FROM request_logs
    WHERE (input_tokens IS NULL OR input_tokens = 0)
      AND client_request IS NOT NULL
  `).all() as Pick<LogRow, "id" | "client_request" | "input_tokens" | "metrics_complete">[];

  console.log(`Found ${inputCandidates.length} records with missing input_tokens`);

  let inputUpdated = 0;
  const updateInputLog = db.prepare(
    "UPDATE request_logs SET input_tokens = ?, input_tokens_estimated = 1 WHERE id = ?"
  );
  const updateInputMetrics = db.prepare(
    "UPDATE request_metrics SET input_tokens = ?, input_tokens_estimated = 1 WHERE request_log_id = ?"
  );

  const txInput = db.transaction(() => {
    for (const row of inputCandidates) {
      const body = parseClientRequest(row.client_request);
      if (!body) continue;
      const allText = extractAllText(body);
      const tokens = countTokens(allText);
      if (tokens === 0) continue;
      updateInputLog.run(tokens, row.id);
      updateInputMetrics.run(tokens, row.id);
      inputUpdated++;
    }
  });
  txInput();
  console.log(`Updated ${inputUpdated} records`);

  // 2. Backfill TPS for streaming records with text content
  console.log("\n=== Backfilling tokens_per_second ===");
  const tpsCandidates = db.prepare(`
    SELECT id, stream_text_content, output_tokens, tokens_per_second, ttft_ms, latency_ms, is_stream, metrics_complete
    FROM request_logs
    WHERE is_stream = 1
      AND stream_text_content IS NOT NULL
      AND ttft_ms IS NOT NULL
      AND latency_ms IS NOT NULL
      AND latency_ms >= ttft_ms
  `).all() as LogRow[];

  console.log(`Found ${tpsCandidates.length} streaming records with text content`);

  let tpsUpdated = 0;
  const updateTpsLog = db.prepare(
    "UPDATE request_logs SET tokens_per_second = ? WHERE id = ?"
  );
  const updateTpsMetrics = db.prepare(
    "UPDATE request_metrics SET tokens_per_second = ? WHERE request_log_id = ?"
  );

  const txTps = db.transaction(() => {
    for (const row of tpsCandidates) {
      const text = extractTextFromStreamContent(row.stream_text_content);

      if (!text) {
        // tool_use-only response, no visible text output → TPS is meaningless
        if (row.tokens_per_second !== null) {
          updateTpsLog.run(null, row.id);
          updateTpsMetrics.run(null, row.id);
          tpsUpdated++;
        }
        continue;
      }

      const textTokens = countTokens(text);
      if (textTokens === 0) continue;
      const textDurationMs = row.latency_ms - row.ttft_ms;
      if (textDurationMs <= 0) continue;
      const tps = textTokens / (textDurationMs / MS_PER_SECOND);

      // Only update if different to avoid unnecessary writes
      const oldTps = row.tokens_per_second;
      if (oldTps !== null && Math.abs(oldTps - tps) < 0.01) continue;

      updateTpsLog.run(Math.round(tps * 100) / 100, row.id);
      updateTpsMetrics.run(Math.round(tps * 100) / 100, row.id);
      tpsUpdated++;
    }
  });
  txTps();
  console.log(`Updated ${tpsUpdated} records`);

  console.log("\n=== Backfill complete ===");
  db.close();
}

main();
