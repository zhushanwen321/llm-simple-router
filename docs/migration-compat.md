# Migration Backward Compatibility Log

> 扫描时间: 2026-05-29 | 迁移范围: 001–052

本文档记录所有"迁移后老版本代码仍可正常运行"的数据库变更。版本稳定后可清理对应迁移和旧列。

## 053: add_thinking_level (2026-06-05)

**关联 ADR**: `docs/adr/0007-log-storage-and-query-optimization.md`

| 操作 | 类型 | 影响 |
|------|------|------|
| `ALTER TABLE request_logs ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off'` | 新增列 | 旧代码不读此列，无影响 |
| `CREATE INDEX idx_request_logs_thinking_level` | 新增索引 | 旧代码不使用此索引，无影响 |

**回退兼容性**: 老代码通过 `json_extract(client_request)` 计算 thinking_level，新列被忽略。新代码直接读 `thinking_level` 列，`COALESCE(rl.thinking_level, 'off')` 兼容未升级的行。

**旧逻辑清理条件**: 当所有行的 `thinking_level` 列已填充正确值（不再依赖查询时 json_extract fallback）时，可移除 admin/logs.ts 中的 `extractThinkingLevel` fallback 和 `LOG_LIST_SELECT` 中的 COALESCE。

## 051: provider_endpoints (2026-05-29)

**关联 ADR**: `docs/adr/0006-provider-multi-api-type-endpoints.md`

| 操作 | 类型 | 影响 |
|------|------|------|
| `ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL` | 新增列 | 旧代码不读此列，无影响 |
| `UPDATE providers SET endpoints = json(...)  WHERE endpoints IS NULL` | 填充新列 | 旧列 api_type/base_url/api_key/upstream_path 数据原样保留 |

**回退兼容性**: 老代码读 api_type/base_url/api_key/upstream_path，这些列完整保留。新增的 endpoints 列被忽略。

**旧列清理条件**: 当所有代码路径都使用 parseEndpoints() / resolveEndpoint() 且不再直接读 api_type/base_url/api_key/upstream_path 时，可移除旧列。

**涉及旧列**:
- `providers.api_type` — 被 `parseEndpoints()` 返回的 `ProviderEndpoint.api_type` 替代
- `providers.base_url` — 被 `ProviderEndpoint.base_url` 替代
- `providers.upstream_path` — 被 `ProviderEndpoint.upstream_path` 替代
- `providers.api_key` — 被 `ProviderEndpoint.api_key` 替代（共享 key 语义不变）

## 052: add_upstream_log_fields (2026-05-29)

| 操作 | 类型 | 影响 |
|------|------|------|
| `ALTER TABLE request_logs ADD COLUMN upstream_api_type TEXT DEFAULT NULL` | 新增列 | 旧代码不写此列，值为 NULL |
| `ALTER TABLE request_logs ADD COLUMN upstream_base_url TEXT DEFAULT NULL` | 新增列 | 同上 |

**回退兼容性**: 老代码写入 request_logs 时不包含这两列，SQLite 对未列出的列自动填 DEFAULT NULL。新代码读取时这两列可为 NULL。

**旧列清理条件**: 此迁移只新增列，无旧列可清理。upstream_api_type/upstream_base_url 是新功能字段，不需要清理。

---

# 全量迁移兼容性扫描报告

以下为逐个扫描 001–052 全部迁移文件后，识别出的向后兼容逻辑。纯新增（CREATE TABLE 新表）和无兼容问题的迁移已跳过。

### 003_add_full_request_chain_log.sql
- **兼容类型**: ADD_COLUMN_KEEP_OLD
- **描述**: 新增 client_request/upstream_request/upstream_response/client_response 四列存储完整请求链，但旧的 request_body/response_body 两列保留。request_body ≈ client_request.body，response_body ≈ upstream_response.body，功能重叠。
- **可清理项**: request_logs.request_body, request_logs.response_body, request_logs.client_response（三列）
- **清理条件**: 已在 020 中完成清理（DROP COLUMN）。无剩余工作。
- **状态**: ✅ 已清理

### 011_create_mapping_groups.sql
- **兼容类型**: DEPRECATED_TABLE
- **描述**: 将 model_mappings 表的数据迁移到新建的 mapping_groups 表（每条旧映射转为 scheduled 策略）。迁移后 model_mappings 表保留为空表，注释明确标注 "旧表 model_mappings 保留为空表（兼容现有测试）"。
- **可清理项**: model_mappings 整张表（含外键约束和索引）
- **清理条件**: 所有代码路径（包括测试）不再读写 model_mappings 表时即可 DROP TABLE。需确认 seedDefaultRules 和 mapping 相关 DAO 不再引用。
- **状态**: 🔴 待清理

### 021_merge_metrics_columns.sql
- **兼容类型**: DATA_MIGRATION_KEEP_OLD
- **描述**: 将 request_metrics 的指标列（input_tokens/output_tokens/cache_read_tokens/ttft_ms/tokens_per_second/stop_reason/backend_model/metrics_complete）冗余复制到 request_logs，消除日志查询的 JOIN。request_metrics 表保留不动，聚合查询仍查它。形成双写格局。
- **可清理项**: request_logs 上的 8 个 metrics 冗余列 + request_logs.input_tokens_estimated（030 追加）+ request_logs.stream_text_content
- **清理条件**: 已在 035 中完成清理（DROP COLUMN）。无剩余工作。
- **状态**: ✅ 已清理

### 026_create_schedules_simplify_mappings.sql
- **兼容类型**: DATA_MIGRATION_KEEP_OLD
- **描述**: 三步变更：(1) 创建 schedules 表，将 mapping_groups.rule 中的 windows 数据迁移到 schedules；(2) 将 mapping_groups.rule 从 `{default, windows}` 格式简化为 `{targets: [...]}` 格式；(3) 注释标注 "保留 strategy 列（兼容旧代码），默认 'scheduled'"。strategy 列继续保留在 mapping_groups 中。
- **可清理项**: mapping_groups.strategy 列。当所有代码通过 schedules 表判断调度策略后，strategy 列可移除。注意 round_robin/random/failover 策略不使用 schedules 表，strategy 列仍需保留直到这些策略的读取方式也统一。
- **清理条件**: mapping_groups 表的 strategy 列值被 schedules 表完全替代，或所有策略类型都通过统一接口读取。
- **状态**: 🟡 部分清理（rule 格式已统一，strategy 列仍保留）

### 029_convert_old_rule_format.sql
- **兼容类型**: DATA_MIGRATION_KEEP_OLD
- **描述**: 修补迁移——将 mapping_groups 中残留的旧格式 rule（`{default, windows}`）统一转为 `{targets}` 格式。这是 026 Step 3 的补做。数据转换后旧格式的 JSON 键（default, windows）从 DB 中消失，但迁移本身依赖 `json_extract(rule, '$.default')` 检测旧数据。
- **可清理项**: 无。此迁移是清理行为本身，完成后旧格式数据已不存在。
- **清理条件**: N/A
- **状态**: ✅ 已完成

### 037_fix_035_data_corruption.sql
- **兼容类型**: DATA_MIGRATION_KEEP_OLD（临时）
- **描述**: 修复 036 迁移（即 035_drop_redundant_log_columns.sql 对应的编号，实为 036_add_openai_responses_api_type.sql）造成的列错位问题。036 用 `INSERT INTO providers_new SELECT * FROM providers` 按位置而非列名匹配数据，导致 providers 表的列值错位。037 创建临时快照表 `_m036_snapshot`，从快照中按位置修复回 providers 表。
- **可清理项**: 无。临时表 `_m036_snapshot` 在迁移结束时 DROP。
- **清理条件**: N/A（已自清理）
- **状态**: ✅ 已完成

### 040_models_object_format.sql
- **兼容类型**: DATA_FORMAT_COEXISTENCE
- **描述**: No-op 迁移（`SELECT 1`）。providers.models 的格式从 `string[]` 演进为 `ModelEntry[]`（对象数组），但格式转换由应用层代码处理（`initDatabase()` → `runApplicationMigrations()`），不在 SQL 迁移中执行。这意味着 DB 中可能同时存在旧格式（纯字符串数组）和新格式（对象数组），`parseModels()` 负责兼容两种格式。
- **可清理项**: providers.models 列中的旧格式数据（string[] 格式的 JSON）
- **清理条件**: 所有 providers.models 都已转换为 `ModelEntry[]` 对象格式后，可从 `parseModels()` 中移除 `typeof entry === 'string'` 的兼容分支。
- **状态**: 🟡 应用层兼容，DB 层未强制

### 050_normalize_patch_ids.sql
- **兼容类型**: DATA_FORMAT_COEXISTENCE
- **描述**: 将 providers.models JSON 中的 patch ID 从连字符格式（thinking-consistency）规范化为下划线格式（thinking_consistency），并尝试去重。但注释说明 "application layer (parseModels) already deduplicates via Set at read time"，即应用层在读时已处理。
- **可清理项**: DB 中可能残留的连字符格式 patch ID
- **清理条件**: 此迁移是 best-effort 清理。应用层已完全兜底，无需额外清理。
- **状态**: ✅ 已完成（应用层兜底）

### 051_provider_endpoints.sql
- **兼容类型**: ADD_COLUMN_KEEP_OLD
- **描述**: 新增 providers.endpoints 列（JSON 数组），将现有 api_type/base_url/upstream_path/api_key 四列数据组合为 JSON 数组写入 endpoints。旧四列完整保留，老代码可继续读取。
- **可清理项**: providers.api_type, providers.base_url, providers.upstream_path, providers.api_key（四列）
- **清理条件**: 所有代码路径都使用 `parseEndpoints()` / `resolveEndpoint()` 且不再直接读取旧四列时，可移除。需同步更新 036 的 CHECK 约束和 providers 表的 CREATE 语句。
- **状态**: 🔴 待清理

---

## 汇总

| 迁移 | 兼容类型 | 状态 | 可清理项 |
|------|---------|------|----------|
| 003 | ADD_COLUMN_KEEP_OLD | ✅ 已清理(020) | request_body/response_body/client_response |
| 011 | DEPRECATED_TABLE | 🔴 待清理 | model_mappings 整表 |
| 021 | DATA_MIGRATION_KEEP_OLD | ✅ 已清理(035) | request_logs 上 9 个 metrics 冗余列 |
| 026 | DATA_MIGRATION_KEEP_OLD | 🟡 strategy 列保留 | mapping_groups.strategy |
| 029 | DATA_MIGRATION_KEEP_OLD | ✅ 已完成 | 旧格式 rule JSON |
| 037 | DATA_MIGRATION_KEEP_OLD(临时) | ✅ 已完成 | _m036_snapshot 临时表 |
| 040 | DATA_FORMAT_COEXISTENCE | 🟡 应用层兼容 | string[] 格式 models 数据 |
| 050 | DATA_FORMAT_COEXISTENCE | ✅ 已完成 | 连字符格式 patch ID |
| 051 | ADD_COLUMN_KEEP_OLD | 🔴 待清理 | api_type/base_url/upstream_path/api_key |

### 待清理优先级

1. **P0 — model_mappings 空表** (011): 最安全的清理项，只需确认无代码引用后 DROP TABLE
2. **P1 — providers 旧四列** (051): 影响面较大，需所有读写路径迁移到 parseEndpoints()/resolveEndpoint()
3. **P2 — mapping_groups.strategy 列** (026): 需策略读取方式统一后才能移除
4. **P3 — parseModels() 旧格式兼容** (040): 需确认所有 providers.models 都已转换为对象格式
