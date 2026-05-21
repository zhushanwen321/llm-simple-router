import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";

const DEFAULT_STATUS_CODE = 502;
const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const DEFAULT_UPSTREAM_PATH = "/v1/chat/completions";
const BYTES_PER_MB = 1_048_576;
const MAX_RESPONSE_MB = 5;
const MAX_RESPONSE_SIZE = MAX_RESPONSE_MB * BYTES_PER_MB;

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallLLMOptions {
  baseUrl: string;
  upstreamPath: string | null;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CallLLMResult {
  content: string;
}

interface StreamChoice {
  message?: {
    content?: string;
  };
}

interface ChatCompletionResponse {
  choices?: StreamChoice[];
}

export function callLLM(options: CallLLMOptions): Promise<CallLLMResult> {
  const path = options.upstreamPath ?? DEFAULT_UPSTREAM_PATH;
  const url = new URL(path, options.baseUrl);

  const requestBody: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: false,
  };
  if (options.maxTokens !== undefined) {
    requestBody.max_tokens = options.maxTokens;
  }

  const payload = JSON.stringify(requestBody);
  const port = url.port ? Number(url.port) : undefined;

  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn({
      hostname: url.hostname,
      port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Length": Buffer.byteLength(payload).toString(),
      },
    });

    if (options.timeoutMs !== undefined) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error("timeout"));
      });
    }

    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      res.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_RESPONSE_SIZE) {
          res.destroy(new Error("Response body exceeds size limit"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf-8");
        const statusCode = res.statusCode ?? DEFAULT_STATUS_CODE;

        if (statusCode < HTTP_OK || statusCode >= HTTP_MULTIPLE_CHOICES) {
          reject(new Error(`LLM API error: status code ${statusCode}`));
          return;
        }

        try {
          const parsed = JSON.parse(responseBody) as ChatCompletionResponse;
          const content = parsed.choices?.[0]?.message?.content;
          resolve({ content: content ?? "" });
        } catch {
          const ERROR_BODY_PREVIEW_LENGTH = 300;
          const preview = responseBody.length > ERROR_BODY_PREVIEW_LENGTH
            ? responseBody.slice(0, ERROR_BODY_PREVIEW_LENGTH) + "..."
            : responseBody;
          reject(new Error(`Failed to parse LLM response: ${preview}`));
        }
      });
      res.on("error", (err: Error) => reject(err));
    });

    req.on("error", (err: Error) => reject(err));

    req.write(payload);
    req.end();
  });
}
