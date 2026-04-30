/** 日志文件按 10 分钟时间窗口切分 */
export const WINDOW_MINUTES = 10;
export const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
export const DIGIT_PAD_WIDTH = 2;

export interface LogFileEntry {
  id: string;
  created_at: string;
  api_type: string;
  status_code: number | null;
  client_request: string | null;
  upstream_request: string | null;
  upstream_response: string | null;
  stream_text_content: string | null;
  pipeline_snapshot: string | null;
}
