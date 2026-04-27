-- Simplify TPS model: thinking + non-thinking (instead of thinking/text/tool_use)
ALTER TABLE request_metrics ADD COLUMN non_thinking_duration_ms INTEGER;
ALTER TABLE request_metrics ADD COLUMN non_thinking_tps REAL;
