-- Migration 028: 将 mapping_groups 中残留旧格式 rule 统一转为 { targets } 格式
-- 背景：旧版 026 曾重建表但未执行 rule 转换，导致部分 entry 仍为 { default, windows } 旧格式。
-- 此迁移补做 026 Step 3 的转换逻辑。

UPDATE mapping_groups
SET rule = json_object('targets', json_array(json_extract(rule, '$.default')))
WHERE json_extract(rule, '$.default') IS NOT NULL AND json_extract(rule, '$.targets') IS NULL;
