# Task 4: 前端改造 — Tabs + SessionTable

> 前置：Task 1-3 完成后执行。后端 session API 已就绪。
> 本 Task 拥有 `frontend/src/api/client.ts`、`ProxyEnhancement.vue`、`SessionTable.vue` 的修改权。

---

## Step 1: 更新前端 API 客户端

- [ ] 修改 `frontend/src/api/client.ts`

**1) 在 `API` 常量中 `PROXY_ENHANCEMENT` 行后追加：**

```ts
SESSION_STATES: '/session-states',
```

**2) 在 `RetryRulePayload` 接口之后追加类型定义（导出）：**

```ts
export interface SessionState {
  id: string
  router_key_id: string
  router_key_name: string
  session_id: string
  current_model: string
  original_model: string | null
  last_active_at: string
  created_at: string
}

export interface SessionHistoryEntry {
  id: string
  old_model: string | null
  new_model: string
  trigger_type: 'directive' | 'command' | 'manual_clear'
  created_at: string
}
```

**3) 在 `api` 对象的 `updateProxyEnhancement` 方法后追加 3 个方法：**

```ts
getSessionStates: () => request<SessionState[]>('get', API.SESSION_STATES),
getSessionHistory: (keyId: string, sessionId: string) =>
  request<SessionHistoryEntry[]>('get', `${API.SESSION_STATES}/${keyId}/${encodeURIComponent(sessionId)}/history`),
deleteSessionState: (keyId: string, sessionId: string) =>
  request<{ success: boolean }>('delete', `${API.SESSION_STATES}/${keyId}/${encodeURIComponent(sessionId)}`),
```

- [ ] Step 1 完成

---

## Step 2: 创建 SessionTable 子组件

- [ ] 创建目录和文件

```bash
mkdir -p frontend/src/components/proxy-enhancement
```

**文件:** `frontend/src/components/proxy-enhancement/SessionTable.vue`

```vue
<template>
  <div v-if="loading" class="text-center py-8 text-muted-foreground">加载中...</div>
  <div v-else-if="sessions.length === 0" class="text-center py-8 text-muted-foreground">暂无活跃 Session</div>
  <Table v-else>
    <TableHeader>
      <TableRow>
        <TableHead>密钥名称</TableHead>
        <TableHead>Session ID</TableHead>
        <TableHead>当前模型</TableHead>
        <TableHead>原始模型</TableHead>
        <TableHead>最后活跃</TableHead>
        <TableHead class="text-right">操作</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <template v-for="session in sessions" :key="session.id">
        <TableRow>
          <TableCell class="font-medium">{{ session.router_key_name }}</TableCell>
          <TableCell>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="font-mono text-xs cursor-default">{{ shortId(session.session_id) }}</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p class="font-mono text-xs">{{ session.session_id }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </TableCell>
          <TableCell>{{ session.current_model }}</TableCell>
          <TableCell class="text-muted-foreground">{{ session.original_model ?? '-' }}</TableCell>
          <TableCell class="text-muted-foreground text-xs">{{ relativeTime(session.last_active_at) }}</TableCell>
          <TableCell class="text-right space-x-1">
            <Button variant="ghost" size="sm" @click="emit('viewHistory', session)">
              {{ historyMap[session.session_id] ? '收起' : '历史' }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="clearingSession = session">
              清除
            </Button>
          </TableCell>
        </TableRow>
        <!-- 历史展开区域 -->
        <TableRow v-if="historyMap[session.session_id]">
          <TableCell colspan="6" class="bg-muted/50 px-8 py-3">
            <div class="space-y-1 text-xs">
              <div v-for="h in historyMap[session.session_id]" :key="h.id" class="flex items-center gap-2">
                <span class="text-muted-foreground w-36">{{ formatTime(h.created_at) }}</span>
                <span>{{ h.old_model ?? '(无)' }}</span>
                <span class="text-muted-foreground">-></span>
                <span>{{ h.new_model }}</span>
                <Badge variant="outline" class="text-[10px] px-1 py-0">{{ h.trigger_type }}</Badge>
              </div>
            </div>
          </TableCell>
        </TableRow>
      </template>
    </TableBody>
  </Table>

  <!-- 清除确认弹窗 -->
  <AlertDialog :open="!!clearingSession" @update:open="(v) => { if (!v) clearingSession = null }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>清除 Session</AlertDialogTitle>
        <AlertDialogDescription>
          确定要清除 session {{ clearingSession ? shortId(clearingSession.session_id) : '' }} 的模型配置吗？它将恢复使用默认模型。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction @click="emit('clear', clearingSession!); clearingSession = null">确认</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { SessionState, SessionHistoryEntry } from '@/api/client'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'

const props = defineProps<{
  sessions: SessionState[]
  loading: boolean
  historyMap: Record<string, SessionHistoryEntry[]>
}>()

const emit = defineEmits<{
  clear: [session: SessionState]
  viewHistory: [session: SessionState]
}>()

const clearingSession = ref<SessionState | null>(null)

function shortId(id: string): string {
  return id.slice(0, 8) + '...'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
</script>
```

- [ ] Step 2 完成

---

## Step 3: 修改 ProxyEnhancement.vue

- [ ] 改造页面结构为 Tabs 布局 + 新增 Session 管理

**文件:** `frontend/src/views/ProxyEnhancement.vue`

**新增 import：**

```ts
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import SessionTable from '@/components/proxy-enhancement/SessionTable.vue'
import type { SessionState, SessionHistoryEntry } from '@/api/client'
```

**新增状态：**

```ts
const sessions = ref<SessionState[]>([])
const sessionsLoading = ref(false)
const sessionHistoryMap = ref<Record<string, SessionHistoryEntry[]>>({})
```

**新增函数：**

```ts
async function loadSessions() {
  sessionsLoading.value = true
  try {
    sessions.value = await api.getSessionStates()
  } catch (e) {
    console.error('Failed to load sessions:', e)
    toast.error('加载 Session 列表失败')
  } finally {
    sessionsLoading.value = false
  }
}

async function handleClearSession(session: SessionState) {
  try {
    await api.deleteSessionState(session.router_key_id, session.session_id)
    toast.success('Session 已清除')
    loadSessions()
  } catch (e) {
    console.error('Failed to clear session:', e)
    toast.error('清除 Session 失败')
  }
}

async function handleViewHistory(session: SessionState) {
  const key = session.session_id
  if (sessionHistoryMap.value[key]) {
    delete sessionHistoryMap.value[key]
    return
  }
  try {
    const history = await api.getSessionHistory(session.router_key_id, session.session_id)
    sessionHistoryMap.value[key] = history
  } catch (e) {
    console.error('Failed to load history:', e)
    toast.error('加载历史记录失败')
  }
}
```

**修改 onMounted：**

```ts
onMounted(() => {
  loadConfig()
  loadSessions()
})
```

**Template 改造：** 在 `<div class="p-6">` 内部，用 Tabs 包裹：

```
Tabs default-value="claude-code"
├── TabsList
│   ├── TabsTrigger "claude-code" → "Claude Code"
│   └── TabsTrigger "opencode" → "OpenCode"
├── TabsContent "claude-code"
│   ├── 保存按钮 header（从页面顶部移入）
│   ├── Card 开关（不变）
│   ├── Collapsible 使用说明（不变）
│   └── Card "活跃 Session"（新增）
│       ├── CardHeader: 标题 + 刷新 Button
│       └── CardContent: <SessionTable
│             :sessions="sessions"
│             :loading="sessionsLoading"
│             :history-map="sessionHistoryMap"
│             @clear="handleClearSession"
│             @view-history="handleViewHistory" />
└── TabsContent "opencode"
    └── 居中提示 "暂未支持 OpenCode 增强"（py-16 text-muted-foreground）
```

- [ ] Step 3 完成

---

## Step 4: 启动前端开发服务器验证

```bash
cd frontend && npm run dev
```

验证项：
- 页面默认显示 Claude Code Tab，开关和使用说明正常
- 点击 OpenCode Tab 显示占位提示
- Session 卡片显示（可能为空列表，因为后端可能无数据）
- 刷新按钮可点击
- 如果有 session 数据，验证 Tooltip、历史展开、清除确认弹窗

- [ ] Step 4 完成

---

## Step 5: 提交

```bash
git add frontend/src/components/proxy-enhancement/SessionTable.vue \
        frontend/src/views/ProxyEnhancement.vue \
        frontend/src/api/client.ts
git commit -m "feat: add session management tab and SessionTable component

- Wrap ProxyEnhancement in Tabs (Claude Code / OpenCode)
- Add SessionTable with history view and clear confirmation
- Add session API methods to client"
```

- [ ] Step 5 完成

---

## 注意事项

- **不新增前端测试**：项目未配置 Vue 组件测试环境
- **shadcn-vue 组件**：所有已安装（tabs、table、alert-dialog、tooltip、badge），无需额外安装
- **类型来源**：`SessionState` 和 `SessionHistoryEntry` 从 `@/api/client` 导入
- **historyMap 由父组件管理**：SessionTable 通过 props 接收 historyMap，通过 emit 通知父组件加载/切换
- **encodeURIComponent**：sessionId 是 UUID，包含 `-` 字符，虽无安全风险但为一致性保留编码
