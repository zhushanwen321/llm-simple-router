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
