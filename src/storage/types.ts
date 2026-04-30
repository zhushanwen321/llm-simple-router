/** JSONL 文件按每 10 分钟一个窗口切分 */
export const WINDOW_MINUTES = 10;
export const TIME_PAD_WIDTH = 2;
/** ISO 日期字符串长度（"YYYY-MM-DD"） */
export const ISO_DATE_LENGTH = 10;

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
