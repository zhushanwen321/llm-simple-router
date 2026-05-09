-- request_metrics 增加 client_type 和 cache_read_tokens_estimated 列。
-- client_type: 客户端类型（claude-code / pi / unknown），用于按客户端统计缓存命中率。
-- cache_read_tokens_estimated: 0 = API 上报，1 = tokenizer 前缀匹配预估。

ALTER TABLE request_metrics ADD COLUMN client_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE request_metrics ADD COLUMN cache_read_tokens_estimated INTEGER NOT NULL DEFAULT 0;
