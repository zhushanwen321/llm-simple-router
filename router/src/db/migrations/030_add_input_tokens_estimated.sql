-- request_metrics / request_logs 增加 input_tokens_estimated 标记，
-- 当 API 未返回 usage.input_tokens 时，后端用 gpt-tokenizer 估算并标记此字段为 1。
-- 前端据此展示 "Est Input Tokens"。

ALTER TABLE request_metrics ADD COLUMN input_tokens_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_logs ADD COLUMN input_tokens_estimated INTEGER NOT NULL DEFAULT 0;
