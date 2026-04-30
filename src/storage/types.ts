/** JSONL 文件按每 10 分钟一个窗口切分 */
export const WINDOW_MINUTES = 10;
/** @deprecated Use WINDOW_MINUTES */
export const LOG_WINDOW_MINUTES = WINDOW_MINUTES;
export const TIME_PAD_WIDTH = 2;

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
