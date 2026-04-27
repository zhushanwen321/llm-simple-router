/**
 * 一键回填历史请求日志和 metrics 数据：
 * 1. input_tokens 为 null/0 时，从 client_request 使用 gpt-tokenizer 估算并标记为 estimated
 * 2. 流式响应有 stream_text_content 时，计算四指标 TPS（thinking_tps, text_tps, tool_use_tps, total_tps）
 */
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { countTokens, estimateInputTokens } from "../src/utils/token-counter.js";

const MS_PER_SECOND = 1000;
const PROGRESS_LOG_INTERVAL = 2000;
const TPS_ROUND_PRECISION = 100;

function parseClientRequest(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.body && typeof parsed.body === "object") {
      return parsed.body as Record<string, unknown>;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** 从 stream_text_content 中提取 thinking、text、tool_use 三类内容 */
function extractStreamBreakdown(raw: string | null): {
  thinking: string; text: string; toolUse: string;
} {
  if (!raw) return { thinking: "", text: "", toolUse: "" };
  // 纯文本格式（无 JSON 包装）：全部视为 text
  if (!raw.trim().startsWith("{")) return { thinking: "", text: raw, toolUse: "" };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const content = parsed.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      let thinking = "";
      let text = "";
      let toolUse = "";
      for (const block of content) {
        if (block.type === "thinking" && typeof block.thinking === "string") {
          thinking += block.thinking;
        } else if (block.type === "text" && typeof block.text === "string") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolUse += JSON.stringify(block.input ?? {});
        }
      }
      return { thinking, text, toolUse };
    }
    // OpenAI 格式
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices.length > 0) {
      const msg = choices[0].message as Record<string, unknown> | undefined;
      if (msg && typeof msg.content === "string") {
        return { thinking: "", text: msg.content, toolUse: "" };
      }
    }
    return { thinking: "", text: "", toolUse: "" };
  } catch {
    return { thinking: "", text: "", toolUse: "" };
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

  const BATCH_SIZE = 500; // 每批处理 500 行，避免大库 OOM

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  console.log(`Opening database: ${dbPath}`);

  // 1. Backfill input_tokens
  console.log("\n=== Backfilling input_tokens ===");
  const inputCount = (db.prepare(`SELECT COUNT(*) as cnt FROM request_logs
    WHERE (input_tokens IS NULL OR input_tokens = 0)
      AND client_request IS NOT NULL`).get() as { cnt: number }).cnt;

  console.log(`Found ${inputCount} records with missing input_tokens`);

  let inputUpdated = 0;
  const updateInputLog = db.prepare(
    "UPDATE request_logs SET input_tokens = ?, input_tokens_estimated = 1 WHERE id = ?"
  );
  const updateInputMetrics = db.prepare(
    "UPDATE request_metrics SET input_tokens = ?, input_tokens_estimated = 1 WHERE request_log_id = ?"
  );

  // 分批读取处理，避免一次性加载全部行导致 OOM
  const inputStmt = db.prepare(`
    SELECT id, client_request, input_tokens, metrics_complete
    FROM request_logs
    WHERE (input_tokens IS NULL OR input_tokens = 0)
      AND client_request IS NOT NULL
    LIMIT ? OFFSET ?
  `);

  let offset = 0;
  while (true) {
    const batch = inputStmt.all(BATCH_SIZE, offset) as Pick<LogRow, "id" | "client_request" | "input_tokens" | "metrics_complete">[];
    if (batch.length === 0) break;

    const txBatch = db.transaction(() => {
      for (const row of batch) {
        const body = parseClientRequest(row.client_request);
        if (!body) continue;
        const tokens = estimateInputTokens(body);
        if (tokens === 0) continue;
        updateInputLog.run(tokens, row.id);
        updateInputMetrics.run(tokens, row.id);
        inputUpdated++;
      }
    });
    txBatch();

    offset += batch.length;
    if (batch.length < BATCH_SIZE) break;
    if (inputUpdated % PROGRESS_LOG_INTERVAL === 0) {
      console.log(`  Progress: ${inputUpdated}/${inputCount} records updated...`);
    }
  }
  console.log(`Updated ${inputUpdated} records`);

  // 2. Backfill TPS breakdown for streaming records
  console.log("\n=== Backfilling TPS breakdown ===");
  const tpsCount = (db.prepare(`SELECT COUNT(*) as cnt FROM request_logs
    WHERE is_stream = 1
      AND stream_text_content IS NOT NULL
      AND ttft_ms IS NOT NULL
      AND latency_ms IS NOT NULL
      AND latency_ms >= ttft_ms`).get() as { cnt: number }).cnt;

  console.log(`Found ${tpsCount} streaming records with text content`);

  let tpsUpdated = 0;
  const updateTpsMetrics = db.prepare(`
    UPDATE request_metrics SET
      tokens_per_second = ?,
      thinking_tokens = ?, text_tokens = ?, tool_use_tokens = ?,
      thinking_tps = ?, text_tps = ?, tool_use_tps = ?, total_tps = ?
    WHERE request_log_id = ?
  `);

  const tpsStmt = db.prepare(`
    SELECT id, stream_text_content, output_tokens, tokens_per_second, ttft_ms, latency_ms, is_stream, metrics_complete
    FROM request_logs
    WHERE is_stream = 1
      AND stream_text_content IS NOT NULL
      AND ttft_ms IS NOT NULL
      AND latency_ms IS NOT NULL
      AND latency_ms >= ttft_ms
    LIMIT ? OFFSET ?
  `);

  offset = 0;
  while (true) {
    const batch = tpsStmt.all(BATCH_SIZE, offset) as LogRow[];
    if (batch.length === 0) break;

    const txBatch = db.transaction(() => {
      for (const row of batch) {
        const { thinking, text, toolUse } = extractStreamBreakdown(row.stream_text_content);

        const thinkingTokens = thinking ? countTokens(thinking) : null;
        const textTokens = text ? countTokens(text) : null;
        const toolUseTokens = toolUse ? countTokens(toolUse) : null;

        const totalDurationMs = row.latency_ms;
        const outputTokens = row.output_tokens ?? 0;

        let totalTps: number | null = null;
        if (outputTokens > 0 && totalDurationMs > 0) {
          totalTps = Math.round(outputTokens / (totalDurationMs / MS_PER_SECOND) * TPS_ROUND_PRECISION) / TPS_ROUND_PRECISION;
        }

        let textTps: number | null = null;
        if (textTokens && textTokens > 0) {
          const textDurationMs = totalDurationMs - row.ttft_ms!;
          if (textDurationMs > 0) {
            textTps = Math.round(textTokens / (textDurationMs / MS_PER_SECOND) * TPS_ROUND_PRECISION) / TPS_ROUND_PRECISION;
          }
        }

        // thinking_tps and tool_use_tps are null because historical data lacks per-phase timing
        // (streaming events were not individually timestamped). Only newly processed requests
        // (with SSEMetricsTransform) will have accurate per-phase TPS breakdowns.
        // Frontend should display "--" for null values in backfilled records.
        const tokensPerSecond = totalTps;

        updateTpsMetrics.run(
          tokensPerSecond,
          thinkingTokens, textTokens, toolUseTokens,
          null, textTps, null, totalTps,
          row.id,
        );
        tpsUpdated++;
      }
    });
    txBatch();

    offset += batch.length;
    if (batch.length < BATCH_SIZE) break;
    if (tpsUpdated % PROGRESS_LOG_INTERVAL === 0) {
      console.log(`  Progress: ${tpsUpdated}/${tpsCount} records updated...`);
    }
  }
  console.log(`Updated ${tpsUpdated} records`);

  console.log("\n=== Backfill complete ===");
  db.close();
}

main();
