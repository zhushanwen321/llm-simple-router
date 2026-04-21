# Task 10: 前端

## Task 10: 前端管理页面 + 筛选扩展

**Files:**
- Create: `frontend/src/views/RouterKeys.vue`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/components/layout/Sidebar.vue`
- Modify: `frontend/src/views/Logs.vue`
- Modify: `frontend/src/views/Metrics.vue`

### 10.1: API Client

- [ ] **Step 1: 在 `frontend/src/api/client.ts` 的 `api` 对象中新增**

```typescript
// Router Keys
getRouterKeys: () => client.get('/router-keys'),
createRouterKey: (data: { name: string; allowed_models?: string[] | null }) =>
  client.post('/router-keys', data),
updateRouterKey: (id: string, data: any) => client.put(`/router-keys/${id}`, data),
deleteRouterKey: (id: string) => client.delete(`/router-keys/${id}`),
getAvailableModels: () => client.get('/models/available'),

// 扩展现有方法
getLogs: (params: { page: number; limit: number; api_type?: string; router_key_id?: string }) =>
  client.get('/logs', { params }),
getMetricsSummary: (params: { period: string; provider_id?: string; backend_model?: string; router_key_id?: string }) =>
  client.get('/metrics/summary', { params }),
getMetricsTimeseries: (params: { period: string; metric: string; provider_id?: string; backend_model?: string; router_key_id?: string }) =>
  client.get('/metrics/timeseries', { params }),
```

### 10.2: Router Keys 管理页面

- [ ] **Step 2: 创建 `frontend/src/views/RouterKeys.vue`**

参照 `Providers.vue` 的模式。核心功能：
- 列表：Table 展示 name、key_prefix（`sk-rout...` 截断展示）、allowed_models（Badge 列表）、状态 Badge、操作
- 创建：Dialog，含 name Input + allowed_models 多选（从 getAvailableModels 获取候选列表）。创建成功后新 Dialog 展示明文 key + 复制按钮 + "仅显示一次"提示
- 编辑：Dialog，含 name、allowed_models 多选、is_active 开关
- 删除：AlertDialog 确认

shadcn-vue 组件：Table, Dialog, AlertDialog, Badge, Input, Button, Switch

### 10.3: 路由和导航

- [ ] **Step 3: 在 `frontend/src/router/index.ts` 新增路由**

```typescript
{
  path: '/admin/keys',
  name: 'router-keys',
  component: () => import('@/views/RouterKeys.vue'),
  meta: { requiresAuth: true },
},
```

插入位置：在 `/admin/mappings` 之后。

- [ ] **Step 4: 在 `frontend/src/components/layout/Sidebar.vue` 的 navItems 中新增**

```typescript
{
  path: '/admin/keys',
  label: 'API Keys',
  icon: '<svg ...key icon...></svg>',
},
```

### 10.4: 日志/指标页面筛选

- [ ] **Step 5: `frontend/src/views/Logs.vue` — 筛选栏新增 API Key 下拉框**

在现有 filterType Select 旁边增加一个 Select，数据源从 `api.getRouterKeys()` 获取。onMounted 时加载 key 列表，选择后传递 `router_key_id` 参数给 getLogs。

- [ ] **Step 6: `frontend/src/views/Metrics.vue` — 筛选栏新增 API Key 下拉框**

类似 Logs.vue，新增 Select，传递 `router_key_id` 给 getMetricsSummary/getMetricsTimeseries。

### 验证和提交

- [ ] **Step 7: 启动前端 dev server 验证**

Run: `cd frontend && npm run dev`

验证点：
- 侧边栏出现 "API Keys" 导航
- 页面能展示空列表
- 创建 key 后弹窗展示明文 key
- 日志/指标页面出现 API Key 筛选下拉框

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: add RouterKeys management page and API Key filter for logs/metrics"
```
