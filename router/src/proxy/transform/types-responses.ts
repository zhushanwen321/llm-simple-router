// ---------- Responses API 输入 item 类型 ----------

export interface ResponseInputMessage {
  type: "message";
  role: "user" | "assistant" | "system" | "developer";
  content: string | ResponseInputContentPart[];
}

export interface ResponseInputText {
  type: "input_text";
  text: string;
}

export interface ResponseInputImage {
  type: "input_image";
  image_url: string;
  detail?: "auto" | "low" | "high";
}

export interface ResponseFunctionCallInput {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponseFunctionCallOutputInput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface ResponseReasoningInput {
  type: "reasoning";
  id: string;
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string;
}

export type ResponseInputItem =
  | ResponseInputMessage
  | ResponseInputText
  | ResponseInputImage
  | ResponseFunctionCallInput
  | ResponseFunctionCallOutputInput
  | ResponseReasoningInput;

export interface ResponseInputContentPart {
  type: "input_text" | "input_image" | "input_file";
  text?: string;
  image_url?: string;
  file_url?: string;
  file_data?: string;
  filename?: string;
}

// ---------- Responses API 工具类型 ----------

export interface ResponseFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponseWebSearchTool {
  type: "web_search_preview";
  search_context_size?: "low" | "medium" | "high";
  user_location?: { type: "approximate"; city?: string; country?: string };
}

export interface ResponseFileSearchTool {
  type: "file_search";
  vector_store_ids?: string[];
}

export type ResponseTool =
  | ResponseFunctionTool
  | ResponseWebSearchTool
  | ResponseFileSearchTool
  | Record<string, unknown>;

// ---------- Responses API 响应输出 ----------

export interface ResponseOutputMessage {
  type: "message";
  id: string;
  role: "assistant";
  content: ResponseOutputContent[];
  status?: string;
}

export interface ResponseOutputContent {
  type: "output_text";
  text: string;
  annotations?: unknown[];
}

export interface ResponseFunctionCallOutput {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: string;
}

export interface ResponseReasoningOutput {
  type: "reasoning";
  id: string;
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string;
}

export type ResponseOutputItem =
  | ResponseOutputMessage
  | ResponseFunctionCallOutput
  | ResponseReasoningOutput
  | Record<string, unknown>;

// ---------- Responses API 完整请求 ----------

export interface ResponsesApiRequest {
  model: string;
  input: string | ResponseInputItem[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponseTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  reasoning?: {
    effort?: "low" | "medium" | "high";
    max_tokens?: number;
    summary?: "auto" | "concise" | "detailed";
  };
  previous_response_id?: string;
  metadata?: Record<string, string>;
  text?: { format: { type: "json_schema"; json_schema: unknown } };
  parallel_tool_calls?: boolean;
  store?: boolean;
}

// ---------- Responses API 完整响应 ----------

export interface ResponsesApiResponse {
  id: string;
  object: "response";
  model: string;
  status: "completed" | "failed" | "in_progress" | "incomplete";
  output: ResponseOutputItem[];
  usage?: ResponsesApiUsage;
  error?: { code: string; message: string };
  created_at?: number;
  completed_at?: number;
}

export interface ResponsesApiUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
}

// ---------- Responses SSE 流式事件类型常量 ----------

export const RESPONSES_SSE_EVENTS = {
  CREATED: "response.created",
  IN_PROGRESS: "response.in_progress",
  QUEUED: "response.queued",
  OUTPUT_ITEM_ADDED: "response.output_item.added",
  OUTPUT_ITEM_DONE: "response.output_item.done",
  CONTENT_PART_ADDED: "response.content_part.added",
  CONTENT_PART_DONE: "response.content_part.done",
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  OUTPUT_TEXT_DONE: "response.output_text.done",
  REFUSAL_DELTA: "response.refusal.delta",
  REFUSAL_DONE: "response.refusal.done",
  FUNCTION_CALL_ARGUMENTS_DELTA: "response.function_call_arguments.delta",
  FUNCTION_CALL_ARGUMENTS_DONE: "response.function_call_arguments.done",
  REASONING_SUMMARY_PART_ADDED: "response.reasoning_summary_part.added",
  REASONING_SUMMARY_PART_DONE: "response.reasoning_summary_part.done",
  REASONING_SUMMARY_TEXT_DELTA: "response.reasoning_summary_text.delta",
  REASONING_SUMMARY_TEXT_DONE: "response.reasoning_summary_text.done",
  REASONING_TEXT_DELTA: "response.reasoning_text.delta",
  REASONING_TEXT_DONE: "response.reasoning_text.done",
  COMPLETED: "response.completed",
  FAILED: "response.failed",
  INCOMPLETE: "response.incomplete",
  ERROR: "error",
} as const;
