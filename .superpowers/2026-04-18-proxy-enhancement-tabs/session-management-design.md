# 代理增强页面改造 + Session 管理

## 背景

当前代理增强页面只有 Claude Code 的开关和使用说明。需要：
1. 支持多工具 Tab 切换（Claude Code / OpenCode）
2. 在 Claude Code Tab 下新增 Session 管理，查看每个 session 的模型配置
3. Session 数据持久化到数据库

## 方案

单页面方案（方案 A）。在 `ProxyEnhancement.vue` 内用 Tabs 切换工具，Claude Code Tab 内包含现有开关 + 新增 Session 管理卡片。

## 数据库设计

迁移文件：`src/db/migrations/016_create_session_model_tables.sql`

### session_model_states 表

存储每个 session 当前的模型配置状态。`id` 使用 `randomUUID()` 生成。

```sql
CREATE TABLE IF NOT EXISTS session_model_states (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  current_model TEXT NOT NULL,
  original_model TEXT,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(router_key_id, session_id),
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_sms_router_key ON session_model_states(router_key_id);
```

### session_model_history 表

记录每次模型切换的审计日志。`id` 使用 `randomUUID()` 生成。

```sql
CREATE TABLE IF NOT EXISTS session_model_history (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  old_model TEXT,
  new_model TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_smh_session ON session_model_history(router_key_id, session_id);
```

`trigger_type` 取值：`directive`（内联指令）、`command`（交互命令）、`manual_clear`（手动清除）。

### 关于 null 处理

`router_key_id` 和 `session_id` 均为 `NOT NULL`。当请求未携带 `x-claude-code-session-id` header 时，不写入数据库，仅使用内存 Map（key 为 `routerKeyId`），保持与当前行为一致。只有携带 session header 的请求才走持久化路径。

## 后端设计

### session-id 提取链路

1. `proxy-core.ts` 的 `handleProxyPost()` 从 `request.headers` 提取 `x-claude-code-session-id`
2. 作为新参数传递给 `applyEnhancement(db, request, clientModel, sessionId)`
3. `applyEnhancement()` 将 `sessionId` 透传给 `modelState.set(routerKeyId, model, sessionId)`

调用点更新：
- `src/proxy/proxy-core.ts` — 提取 header，传递 sessionId
- `src/proxy/enhancement-handler.ts` — 函数签名增加 sessionId 参数
- `src/proxy/model-state.ts` — 接口改为接受 sessionId

### ModelStateManager 改造

内存 Map 的 key 格式：`routerKeyId` 或 `routerKeyId:sessionId`（sessionId 存在时）。

- **set(routerKeyId, model, sessionId?)**:
  - 内存：key 为 `sessionId ? `${routerKeyId}:${sessionId}` : routerKeyId`
  - 数据库：仅当 sessionId 存在时执行 `db.transaction()` 包裹的 UPSERT states + INSERT history
  - DB 失败时不回滚内存（better-sqlite3 同步操作极少失败，且内存状态优先保证请求正常响应）
- **get(routerKeyId, sessionId?)**:
  - 内存 key 同上
  - 内存 miss 时，若 sessionId 存在则查数据库，命中后回填内存
- **delete(routerKeyId, sessionId)**:
  - 同时清理内存和数据库（DELETE states + INSERT manual_clear history），包裹在 `db.transaction()` 中

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/api/session-states` | 所有活跃 session 列表 |
| GET | `/admin/api/session-states/:keyId/:sessionId/history` | 某个 session 的切换历史 |
| DELETE | `/admin/api/session-states/:keyId/:sessionId` | 清除 session 模型配置 |

### API 响应结构

**GET /admin/api/session-states**

```ts
interface SessionState {
  id: string;
  router_key_id: string;
  router_key_name: string;        // 关联 router_keys.name
  session_id: string;
  current_model: string;
  original_model: string | null;
  last_active_at: string;
  created_at: string;
}
// 响应: SessionState[]
```

**GET .../history**

```ts
interface SessionHistoryEntry {
  id: string;
  old_model: string | null;
  new_model: string;
  trigger_type: 'directive' | 'command' | 'manual_clear';
  created_at: string;
}
// 响应: SessionHistoryEntry[]，按 created_at DESC 排序，不分页
```

**DELETE ...**

```ts
// 响应: { success: boolean }
```

## 前端设计

### Tab 值定义

- `"claude-code"` — Claude Code Tab（默认激活）
- `"opencode"` — OpenCode Tab

### 页面结构

```
代理增强页面
├── Tabs default="claude-code"
│   ├── TabsContent "claude-code"
│   │   ├── 现有开关 + 使用说明（不变）
│   │   └── Card "活跃 Session"
│   │       ├── 卡片头：标题 + 刷新按钮
│   │       └── SessionTable 子组件
│   └── TabsContent "opencode"
│       └── 居中提示 "暂未支持 OpenCode 增强"
```

### SessionTable 子组件

- 列：密钥名称 | Session ID（前 8 位 + Tooltip）| 当前模型 | 原始模型 | 最后活跃 | 操作
- 操作：查看历史（展开行）/ 清除配置（AlertDialog 确认）
- 历史展开后按时间倒序显示切换时间线

### 数据刷新策略

- 页面加载时获取一次
- 手动点击刷新按钮重新获取
- 清除 session 后自动刷新列表

### 新增文件

- `frontend/src/components/proxy-enhancement/SessionTable.vue`
- `frontend/src/api/client.ts` 新增 3 个 API 方法

### 组件

使用项目已有的 shadcn-vue 组件：Tabs、Table、AlertDialog、Tooltip、Card。
