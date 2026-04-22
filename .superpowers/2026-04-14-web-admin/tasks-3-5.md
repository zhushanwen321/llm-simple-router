# Task 3-5 实施步骤：前端 + 集成

> 前置条件：Task 1-2 已完成，后端 `/admin/api/*` 接口可用。

---

## Task 3: Vue 3 前端初始化 + 登录页

### Step 3.1: 创建 Vite 项目骨架

在项目根目录下创建 `frontend/` 目录并初始化：

```bash
cd /Users/zhushanwen/Code/llm-simple-router
npm create vite@latest frontend -- --template vue-ts
cd frontend
npm install
```

### Step 3.2: 安装依赖

```bash
# 路由 + HTTP
npm install vue-router@4 axios

# Tailwind CSS v3
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p

# shadcn-vue 依赖
npm install radix-vue class-variance-authority clsx tailwind-merge lucide-vue-next
```

### Step 3.3: 配置 Tailwind CSS

**`frontend/tailwind.config.js`**:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

**`frontend/src/style.css`** — 添加 Tailwind 指令：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Step 3.4: 配置 shadcn-vue

**`frontend/components.json`**:

```json
{
  "style": "default",
  "typescript": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/style.css",
    "baseColor": "slate"
  },
  "framework": "vite",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

**`frontend/src/lib/utils.ts`** — shadcn-vue 工具函数：

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### Step 3.5: 配置 Vite

**`frontend/vite.config.ts`**:

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/admin/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
```

### Step 3.6: 创建 API 客户端

**`frontend/src/api/client.ts`**:

```typescript
import axios from 'axios'
import router from '@/router'

const client = axios.create({
  baseURL: '/admin/api',
  withCredentials: true,  // 发送 HttpOnly cookie
})

// 响应拦截器：401 时跳转登录
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      router.push('/admin/login')
    }
    return Promise.reject(error)
  }
)

export const api = {
  login: (password: string) => client.post('/login', { password }),
  logout: () => client.post('/logout'),

  getServices: () => client.get('/services'),
  createService: (data: any) => client.post('/services', data),
  updateService: (id: number, data: any) => client.put(`/services/${id}`, data),
  deleteService: (id: number) => client.delete(`/services/${id}`),

  getMappings: () => client.get('/mappings'),
  createMapping: (data: any) => client.post('/mappings', data),
  updateMapping: (id: number, data: any) => client.put(`/mappings/${id}`, data),
  deleteMapping: (id: number) => client.delete(`/mappings/${id}`),

  getLogs: (params: { page: number; limit: number; api_type?: string }) =>
    client.get('/logs', { params }),
  deleteLogsBefore: (before: string) =>
    client.delete('/logs/before', { data: { before } }),

  getStats: () => client.get('/stats'),
}

export default client
```

### Step 3.7: 创建 Vue Router

**`frontend/src/router/index.ts`**:

```typescript
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/admin/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/admin/',
      name: 'dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/services',
      name: 'services',
      component: () => import('@/views/Services.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/mappings',
      name: 'mappings',
      component: () => import('@/views/ModelMappings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/logs',
      name: 'logs',
      component: () => import('@/views/Logs.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// 路由守卫：认证检查
router.beforeEach(async (to, _from, next) => {
  if (to.meta.requiresAuth) {
    try {
      // 用一个轻量请求验证 cookie 是否有效
      const axios = (await import('@/api/client')).default
      await axios.get('/stats')
      next()
    } catch {
      next('/admin/login')
    }
  } else {
    next()
  }
})

export default router
```

### Step 3.8: 创建 Login.vue

**`frontend/src/views/Login.vue`**:

核心要点：
- 使用 shadcn-vue 的 `Card`, `CardHeader`, `CardContent`, `CardFooter`, `Input`, `Button` 组件
- 响应式变量：`password`（绑定输入框）、`error`（错误信息）、`loading`（提交状态）
- 提交时调用 `api.login(password)`
- 成功 → `router.push('/admin/')`
- 失败 → 显示 error message
- 页面居中布局，简洁的卡片样式

先安装需要的 shadcn-vue 组件（手动创建文件）：

```bash
npx shadcn-vue@latest add card input button label
```

### Step 3.9: 创建 App.vue 布局

**`frontend/src/App.vue`**:

```typescript
// 逻辑
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Sidebar from '@/components/layout/Sidebar.vue'
import { api } from '@/api/client'

const router = useRouter()
const route = useRoute()
const isAuthenticated = ref(false)

onMounted(async () => {
  try {
    await api.getStats()
    isAuthenticated.value = true
  } catch {
    isAuthenticated.value = false
  }
})

// 监听路由变化更新认证状态
watch(() => route.path, () => {
  // 登录页不检查
  if (route.path === '/admin/login') return
  // 其他页面检查认证
  api.getStats().then(() => isAuthenticated.value = true)
    .catch(() => { isAuthenticated.value = false; router.push('/admin/login') })
})
```

模板结构：
- `isAuthenticated` 为 true → 侧边栏（左侧固定宽度）+ `<router-view />`（右侧内容区）
- `isAuthenticated` 为 false → 直接显示 `<router-view />`（即 Login 页面）

### Step 3.10: 创建 Sidebar 组件

**`frontend/src/components/layout/Sidebar.vue`**:

- 导航链接列表：Dashboard、Services、Model Mappings、Logs
- 底部登出按钮
- 使用 `router-link` 实现导航
- 当前路由高亮（`router-link-active` 类）
- 简洁样式：固定宽度 `w-56`，深色背景

### Step 3.11: 更新 main.ts

**`frontend/src/main.ts`**:

```typescript
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
```

### Task 3 验收

```bash
# 1. 启动后端（确保 Task 1-2 已实现）
npm run dev

# 2. 启动前端
cd frontend && npm run dev

# 3. 验证
# - 浏览器打开 http://localhost:5173/admin/login
# - 输入错误密码 → 显示错误提示
# - 输入正确密码 → 跳转到 /admin/ Dashboard
# - 点击登出 → 跳回 /admin/login
```

---

## Task 4: 管理页面（Services + Mappings + Logs + Dashboard）

### Step 4.1: 安装额外 shadcn-vue 组件

```bash
cd frontend
npx shadcn-vue@latest add table dialog select badge alert-dialog separator
```

### Step 4.2: Dashboard.vue

**`frontend/src/views/Dashboard.vue`**

数据获取：
- `onMounted` 调用 `api.getStats()`
- 响应式存储 stats 数据

展示内容（4 张统计卡片）：
- 总请求数
- 成功率（百分比）
- 平均延迟（ms）
- 最近 24h 请求数

卡片布局使用 CSS Grid：`grid-cols-2 lg:grid-cols-4`

每张卡片使用 shadcn-vue `Card` 组件：
- `CardHeader`：标题 + 图标
- `CardContent`：大号数字

如果 stats 包含各模型请求分布数据，可以用简单的 CSS 条形图展示（不需要 recharts 等图表库）。

### Step 4.3: Services.vue

**`frontend/src/views/Services.vue`**

数据获取：
- `onMounted` 调用 `api.getServices()`
- 响应式变量：`services`（列表）、`dialogOpen`、`editingService`、`formData`

表格列：
| 列名 | 字段 | 说明 |
|------|------|------|
| Name | name | 服务名称 |
| API Type | api_type | openai / anthropic |
| Base URL | base_url | 后端地址 |
| API Key | api_key | 脱敏显示 |
| Status | is_active | Badge 标签 |
| Actions | - | 编辑 / 删除按钮 |

交互逻辑：
- **添加**：`formData` 初始化为空对象，打开 Dialog
- **编辑**：`formData` 预填当前行数据，打开 Dialog
- **保存**：判断 `editingService` 是否存在，调用 create 或 update API
- **删除**：弹出 AlertDialog 确认，调用 delete API
- 操作完成后刷新列表

Dialog 表单字段：
- name (Input)
- api_type (Select: openai / anthropic)
- base_url (Input)
- api_key (Input type=password，编辑时留空表示不修改)
- is_active (Checkbox)

### Step 4.4: ModelMappings.vue

**`frontend/src/views/ModelMappings.vue`**

数据获取：
- `onMounted` 并行调用 `api.getMappings()` 和 `api.getServices()`（下拉选项）
- 响应式变量：`mappings`、`services`（用于下拉）、`dialogOpen`、`editingMapping`、`formData`

表格列：
| 列名 | 字段 | 说明 |
|------|------|------|
| Client Model | client_model | 客户端请求的模型名 |
| Backend Model | backend_model | 实际转发的模型名 |
| Service | service_id | 关联服务名称（通过 services 查找） |
| Status | is_active | Badge |
| Actions | - | 编辑 / 删除 |

Dialog 表单字段：
- client_model (Input)
- backend_model (Input)
- service_id (Select，选项来自 services 列表)
- is_active (Checkbox)

交互逻辑与 Services.vue 相同。

### Step 4.5: Logs.vue

**`frontend/src/views/Logs.vue`**

数据获取：
- `onMounted` 调用 `loadLogs()`
- 响应式变量：`logs`、`pagination`（page, limit, total）、`filters`（api_type, model）

表格列：
| 列名 | 字段 | 说明 |
|------|------|------|
| Time | created_at | 格式化时间 |
| API Type | api_type | Badge |
| Model | model | 模型名 |
| Status | status_code | HTTP 状态码 |
| Latency | latency_ms | 毫秒 |
| Stream | is_stream | 是/否 |
| Error | error_message | 错误信息（可折叠） |

过滤控件（表格上方）：
- API Type 下拉选择（all / openai / anthropic）
- 搜索框（暂不实现模型搜索，仅 UI 占位）

分页控件：
- 上一页 / 下一页按钮
- 当前页 / 总页数显示

清理功能：
- 清理按钮 → Dialog 输入天数 N
- 调用 `api.deleteLogsBefore(N 天前的 ISO 日期字符串)`
- 确认后刷新列表

`loadLogs` 函数：
```typescript
async function loadLogs() {
  const params: any = { page: pagination.page, limit: pagination.limit }
  if (filters.api_type) params.api_type = filters.api_type
  const res = await api.getLogs(params)
  logs.value = res.data.logs ?? res.data
  // 如果后端返回 total，更新 pagination.total
}
```

### Task 4 验收

```bash
# 1. 确保后端和前端都在运行
# 2. 登录后访问各页面
# 3. Dashboard：显示统计数据
# 4. Services：添加、编辑、删除服务
# 5. Mappings：添加、编辑、删除映射，下拉选择服务
# 6. Logs：查看日志、翻页、过滤、清理
```

---

## Task 5: 集成 + Docker 多阶段构建更新

### Step 5.1: 更新 Dockerfile

在现有 Dockerfile 中添加前端构建阶段。最终结构为三阶段构建：

**阶段 0：构建前端**（新增）

```dockerfile
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build
```

**阶段 1：构建后端**（原 builder 阶段，保持不变）

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src/ src/
RUN npm run build
```

**阶段 2：运行时**（在 COPY 编译产物之后添加前端产物复制）

```dockerfile
# 在现有 COPY --from=builder 之后添加：
COPY --from=frontend-builder /app/frontend/dist /app/frontend-dist/
```

### Step 5.2: 安装 @fastify/static

```bash
cd /Users/zhushanwen/Code/llm-simple-router
npm install @fastify/static
```

### Step 5.3: 注册静态文件服务

**`src/index.ts`** 修改：

在 `buildApp` 函数中，注册静态文件服务插件：

```typescript
import path from "node:path";
import fastifyStatic from "@fastify/static";

// 在其他 register 之后添加：
const frontendDist = path.resolve(
  process.env.FRONTEND_DIST || path.join(__dirname, "../frontend-dist")
);

app.register(fastifyStatic, {
  root: frontendDist,
  prefix: "/admin/",
  wildcard: false,
  decorateReply: false,
});

// SPA fallback: /admin/ 下非 API 路径返回 index.html
app.setNotFoundHandler((request, reply) => {
  if (
    request.url.startsWith("/admin") &&
    !request.url.startsWith("/admin/api")
  ) {
    return reply.sendFile("index.html");
  }
  reply.code(404).send({ error: "Not Found" });
});
```

注意：`setNotFoundHandler` 只能注册一次，如果现有代码已使用它，需改为在现有 handler 内添加条件判断。

### Step 5.4: 更新认证中间件

**`src/middleware/auth.ts`** 修改：

当前 `SKIP_PATHS` 已包含 `/admin`，这意味着所有 `/admin/` 开头的路径都跳过了 API Key 认证。这是正确的行为，因为：

1. `/admin/api/login` 和 `/admin/api/logout` 不需要 API Key，由 JWT 中间件处理
2. `/admin/` 和 `/admin/index.html` 等静态文件不需要 API Key
3. `/admin/api/*` 的 JWT 认证由 `src/middleware/admin-auth.ts`（Task 1-2 创建）处理

**确认 `SKIP_PATHS` 逻辑**：当前实现中 `shouldSkipAuth` 会对所有 `/admin` 前缀路径跳过 API Key 检查。这符合预期，无需修改。

### Step 5.5: Docker Compose 验证（可选）

如果项目有 `docker-compose.yml`，确认无需额外修改。检查现有 `docker-compose.yml`：

```bash
# 构建并测试
docker compose build
docker compose up -d
# 浏览器访问 http://localhost:3000/admin/
```

### Step 5.6: 开发环境验证

不使用 Docker 的验证方式：

```bash
# 1. 构建前端
cd frontend && npm run build

# 2. 设置 FRONTEND_DIST 环境变量
export FRONTEND_DIST=/Users/zhushanwen/Code/llm-simple-router/frontend/dist

# 3. 启动后端
cd /Users/zhushanwen/Code/llm-simple-router && npm run dev

# 4. 浏览器访问 http://localhost:3000/admin/
```

### Task 5 验收

```bash
# Docker 方式
docker compose build
docker compose up -d

# 验证流程
# 1. 访问 http://localhost:3000/admin/ → 显示登录页
# 2. 输入密码登录 → Dashboard
# 3. 管理后端服务（增删改查）
# 4. 管理模型映射（增删改查）
# 5. 查看日志（分页、过滤、清理）
# 6. 登出 → 回到登录页

# 非 Docker 方式
cd frontend && npm run build
export FRONTEND_DIST=$(pwd)/dist
cd .. && npm run dev
# 同上验证流程
```

---

## 执行注意事项

### 依赖顺序

Task 3 → Task 4 → Task 5 严格串行。Task 4 的页面需要 Task 3 的路由和 API 客户端就绪。Task 5 的集成需要 Task 4 的前端代码完成。

### shadcn-vue 组件管理

推荐使用 CLI 按需安装组件（`npx shadcn-vue@latest add <component>`），避免一次性安装所有组件。每个 Step 标注了需要安装的组件。

### 开发与生产的路径差异

| 场景 | 前端访问路径 | 后端 API 路径 |
|------|-------------|-------------|
| 开发 | localhost:5173（Vite） | Vite proxy → localhost:3000 |
| 生产 | localhost:3000/admin/（@fastify/static） | localhost:3000/admin/api/ |

前端代码中所有 API 请求使用相对路径 `/admin/api/...`，无需环境区分。

### 前端未构建时的容错

`@fastify/static` 注册时如果目录不存在会导致启动失败。建议在 `src/index.ts` 中添加目录存在性检查：

```typescript
import { existsSync } from "node:fs";

if (existsSync(frontendDist)) {
  app.register(fastifyStatic, { ... });
  // setNotFoundHandler
} else {
  app.log.warn(`Frontend dist not found at ${frontendDist}, skipping static serving`);
}
```
