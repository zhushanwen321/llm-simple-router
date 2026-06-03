# R2: RouterKeys.vue 前端页面复审

## 审查范围

- feat: `frontend/src/views/RouterKeys.vue`
- main: `frontend/src/views/RouterKeys.vue`
- 后端: `router/src/admin/router-keys.ts`
- API client: `frontend/src/api/client.ts`
- 类型: `frontend/src/models.ts` (`RouterKey`)

## 上一轮修复验证

### 1. clipboard 未 await — 已修复

feat 分支 `copyKey()` 和 `copyRevealKey()` 均通过 `await copyToClipboard(text)` 正确 await，且有 Secure Context 降级 (`fallbackCopy`)。main 分支使用 `useClipboard()` composable 也是 await 的，两者等价。

### 2. 已选模型不可取消选择 — 已修复

feat 分支 `toggleModel()` 函数正确处理了 `val === true` 添加、`!val` 移除的逻辑。Checkbox 的 `@update:model-value` 对已勾选项传入 `false`，会走 `!val` 分支执行 `splice` 移除。

## 功能完整性对比

| 功能 | main | feat | 状态 |
|------|------|------|------|
| CRUD：列表 | ✓ | ✓ | 等价 |
| CRUD：创建 | ✓ | ✓ | feat 新增创建后展示密钥对话框 |
| CRUD：编辑 | ✓ | ✓ | 等价 |
| CRUD：删除（AlertDialog） | ✓ | ✓ | 等价 |
| 启用/禁用切换 | 无（需编辑） | ✓（独立按钮） | feat 新增功能 |
| 密钥掩码显示 | ✓（固定掩码） | ✓（key_prefix + 掩码） | feat 更优 |
| 密钥明文揭示 | 无 | ✓（toggleReveal） | feat 新增功能 |
| 搜索过滤 | 无 | ✓ | feat 新增功能 |
| 模型白名单过滤 | 无 | ✓（modelFilter） | feat 新增功能 |
| 统计栏 | 无 | ✓（总数/活跃/白名单） | feat 新增功能 |
| 空状态区分 | 仅一种 | 全空 vs 无匹配 | feat 更优 |
| 并行加载 | Promise.allSettled | Promise.allSettled | 等价 |
| 错误处理 | console + toast | console + toast | 等价 |

## 字段对齐检查

| 后端字段 | API 类型 | 页面使用 | 状态 |
|----------|----------|----------|------|
| `id` | ✓ | ✓ (key, CRUD) | 正常 |
| `name` | ✓ | ✓ (表格, 表单) | 正常 |
| `key` | `string \| null` | ✓ (复制, 揭示) | 正常 |
| `key_prefix` | ✓ | ✓ (掩码显示) | 正常 |
| `allowed_models` | `string[] \| null` | ✓ (Badge, 表单) | 正常 |
| `is_active` | `number` | ✓ (状态, 切换, 表单) | 正常 |
| `created_at` | ✓ | ✓ (表格) | 正常 |

## 结论

**无功能性 bug。** 

上一轮修复的 2 个问题（clipboard await、已选模型取消）均已正确修复。CRUD 操作与后端 API 完全对齐，数据字段无遗漏，错误处理符合规范（console.error + toast）。
