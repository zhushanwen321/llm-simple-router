# 代理增强页面改造 + Session 管理

## 背景

当前代理增强页面只有 Claude Code 的开关和使用说明。需要：
1. 支持多工具 Tab 切换（Claude Code / OpenCode）
2. 在 Claude Code Tab 下新增 Session 管理，查看每个 session 的模型配置
3. Session 数据持久化到数据库

## 方案

单页面方案（方案 A）。在 `ProxyEnhancement.vue` 内用 Tabs 切换工具，Claude Code Tab 内包含现有开关 + 新增 Session 管理卡片。

## 数据库设计

### session_model_states 表

存储每个 session 当前的模型配置状态。

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

记录每次模型切换的审计日志。

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

## 后端设计

### ModelStateManager 改造

- **复合键**：从 `routerKeyId` 改为 `(routerKeyId, sessionId)` 元组
- **双写策略**：`set()` 同时写入内存 Map 和数据库（UPSERT states + INSERT history）
- **冷启动 fallback**：`get()` miss 时从数据库读取
- **清除**：`delete()` 同时清理内存和数据库，并写入 `manual_clear` 历史记录

### session-id 提取

在 `applyEnhancement()` 中从 request headers 提取 `x-claude-code-session-id`，传递给 `ModelStateManager`。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/api/session-states` | 所有活跃 session 列表，关联 router_keys 表 |
| GET | `/admin/api/session-states/:keyId/:sessionId/history` | 某个 session 的切换历史 |
| DELETE | `/admin/api/session-states/:keyId/:sessionId` | 清除 session 模型配置 |

## 前端设计

### 页面结构

```
代理增强页面
├── Tabs（Claude Code / OpenCode）
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

### 新增文件

- `frontend/src/components/proxy-enhancement/SessionTable.vue`
- `frontend/src/api/client.ts` 新增 3 个 API 方法

### 组件

使用项目已有的 shadcn-vue 组件：Tabs、Table、AlertDialog、Tooltip、Card。
