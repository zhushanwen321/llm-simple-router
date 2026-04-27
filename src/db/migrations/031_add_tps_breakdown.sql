-- 030: TPS 四指标拆分
-- 原始数据列（tokenizer 计数 + 各阶段耗时）
ALTER TABLE request_metrics ADD COLUMN thinking_tokens INTEGER;
ALTER TABLE request_metrics ADD COLUMN text_tokens INTEGER;
ALTER TABLE request_metrics ADD COLUMN tool_use_tokens INTEGER;
ALTER TABLE request_metrics ADD COLUMN thinking_duration_ms INTEGER;
ALTER TABLE request_metrics ADD COLUMN text_duration_ms INTEGER;
ALTER TABLE request_metrics ADD COLUMN tool_use_duration_ms INTEGER;
-- 计算结果列
ALTER TABLE request_metrics ADD COLUMN thinking_tps REAL;
ALTER TABLE request_metrics ADD COLUMN text_tps REAL;
ALTER TABLE request_metrics ADD COLUMN tool_use_tps REAL;
ALTER TABLE request_metrics ADD COLUMN total_tps REAL;
