# 插件系统规格

## 目标
不同 Provider 有各自怪癖（Bedrock 特殊 header、Vertex AI 特殊认证等），核心转换器无法全部覆盖。插件系统让个性化逻辑不侵入核心代码。

## 双层架构

### Tier 1: 声明式规则（DB + Admin UI）
存储在 provider_transform_rules 表，Admin UI 可视化编辑。启动时自动注册为内置插件实例。

DB 表结构：
```sql
CREATE TABLE IF NOT EXISTS provider_transform_rules (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  inject_headers TEXT,          -- JSON: {"anthropic-version": "2023-06-01"}
  request_defaults TEXT,        -- JSON: {"max_tokens": 4096}
  drop_fields TEXT,             -- JSON: ["logprobs", "frequency_penalty"]
  field_overrides TEXT,         -- JSON: {"stop_reason_map": {...}}
  plugin_name TEXT,             -- 关联文件插件名
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

声明式规则自动转译为 TransformPlugin 实例，在 afterRequestTransform/afterResponseTransform 钩子中执行：
- requestDefaults: 缺失字段注入默认值
- dropFields: 丢弃字段
- injectHeaders: 追加上游 header
- fieldOverrides: 覆盖特定映射

### Tier 2: 代码插件（文件系统）
用户在 plugins/ 目录放置 JS 文件，每个文件导出 TransformPlugin 接口。

## 插件接口

```typescript
interface PluginMatch {
  providerId?: string;
  providerName?: string;
  providerNamePattern?: string; // 正则
  apiType?: "openai" | "anthropic";
}

interface TransformPlugin {
  name: string;
  match: PluginMatch;
  beforeRequestTransform?(ctx: RequestTransformContext): void;
  afterRequestTransform?(ctx: RequestTransformContext): void;
  beforeResponseTransform?(ctx: ResponseTransformContext): void;
  afterResponseTransform?(ctx: ResponseTransformContext): void;
}

interface RequestTransformContext {
  body: Record<string, unknown>;
  sourceApiType: "openai" | "anthropic";
  targetApiType: "openai" | "anthropic";
  provider: { id: string; name: string; base_url: string; api_type: string };
}

interface ResponseTransformContext {
  response: Record<string, unknown>;
  sourceApiType: "openai" | "anthropic";
  targetApiType: "openai" | "anthropic";
  provider: { id: string; name: string; base_url: string; api_type: string };
}
```

## 执行管道
核心转换 → 匹配插件的 beforeRequestTransform → 核心格式转换 → 匹配插件的 afterRequestTransform → 声明式规则 → applyProviderPatches → Transport

## 内存缓存
启动时: SELECT * FROM provider_transform_rules WHERE is_active=1 → Map<providerId, TransformRules>
请求时: provider.id → 缓存查找

## Admin API
| 端点 | 方法 | 用途 |
|------|------|------|
| /admin/api/transform-rules/:providerId | GET | 获取规则 |
| /admin/api/transform-rules/:providerId | PUT | Upsert 规则 |
| /admin/api/transform-rules/:providerId | DELETE | 删除规则 |
| /admin/api/transform-rules/reload | POST | 热重载（重扫 plugins/ + 重载 DB） |

## Admin UI
Provider 编辑页新增"转换规则"折叠面板：Header 注入（键值对编辑器）、请求默认值（键值对编辑器）、字段丢弃（标签输入）、字段覆盖（JSON 编辑器）、关联插件（下拉选择）、保存/重载按钮。

## 热重载流程
1. 重新扫描 plugins/ 目录，加载/更新/移除文件插件
2. 重新从 DB 加载声明式规则，生成 Tier 1 插件实例
3. 重建内存中的插件注册表（按 match 条件索引）
4. 返回 { loadedPlugins: [...], rules: [...] }

## 代码插件示例
```typescript
// plugins/bedrock-claude.ts
export default {
  name: "bedrock-claude",
  match: { providerNamePattern: "bedrock" },
  afterRequestTransform(ctx) {
    ctx.body.anthropic_version = "2023-06-01";
  },
};
```
