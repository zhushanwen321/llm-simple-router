<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-foreground mb-4">代理增强（实验性）</h2>

    <Tabs default-value="dynamic-model">
      <TabsList>
        <TabsTrigger value="dynamic-model">动态模型切换</TabsTrigger>
        <TabsTrigger value="loop-detection">循环输出检测</TabsTrigger>
      </TabsList>
      <TabsContent value="dynamic-model">
        <Card>
          <CardHeader>
            <CardTitle>Claude Code 动态模型切换</CardTitle>
            <CardDescription>
              在 Claude Code 对话中通过 /select-model 命令动态切换后端模型。模型选择在当前会话内有效（24h），不影响路由配置。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="claude-code-toggle"
                v-model="claudeCodeEnabled"
              />
              <Label for="claude-code-toggle">
                {{ claudeCodeEnabled ? '已启用' : '已禁用' }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <div class="flex justify-end mt-4">
          <Button :disabled="saving" @click="handleSave">
            <span v-if="saving" class="flex items-center gap-1">
              <Loader2 class="w-4 h-4 animate-spin" />
              保存中...
            </span>
            <span v-else>保存</span>
          </Button>
        </div>

        <!-- 使用说明 -->
        <Collapsible v-model:open="instructionsOpen" class="mt-4">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full justify-between">
              <span>使用说明</span>
              <ChevronDown class="w-4 h-4 transition-transform" :class="{ 'rotate-180': instructionsOpen }" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="mt-2">
            <Card>
              <CardContent class="space-y-4 text-sm">
                <div>
                  <p class="font-medium text-foreground mb-1 leading-relaxed">配置方法</p>
                  <p class="text-muted-foreground leading-relaxed">
                    在 Claude Code 项目级或全局级目录下创建 Command 文件：
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    # 项目级 .claude/commands/select-model.md<br />
                    # 全局级 ~/.claude/commands/select-model.md
                  </code>
                  <p class="text-muted-foreground leading-relaxed mt-2">
                    文件内容：
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed" v-text="selectModelInstruction" />
                </div>
                <div>
                  <p class="font-medium text-foreground mb-1 leading-relaxed">使用方法</p>
                  <p class="text-muted-foreground leading-relaxed">
                    查看可用模型列表（格式为 provider_name/backend_model）：
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    /select-model
                  </code>
                  <p class="text-muted-foreground leading-relaxed mt-2">
                    选择模型并记住到当前会话：
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    /select-model provider_name/backend_model
                  </code>
                  <p class="text-muted-foreground leading-relaxed mt-2">
                    切换后在下方活跃 Session 表中确认状态，请求日志中可验证路由是否生效。
                  </p>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <!-- 活跃 Session -->
        <Card class="mt-4">
          <CardHeader>
            <div class="flex items-center justify-between">
              <div>
                <CardTitle>活跃 Session</CardTitle>
                <CardDescription>查看和管理当前已配置模型的 session</CardDescription>
              </div>
              <Button variant="outline" size="sm" @click="loadSessions" :disabled="sessionsLoading">刷新</Button>
            </div>
          </CardHeader>
          <CardContent>
            <SessionTable
              :sessions="sessions"
              :loading="sessionsLoading"
              :history-map="sessionHistoryMap"
              @clear="handleClearSession"
              @view-history="handleViewHistory"
            />
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="loop-detection">
        <Card>
          <CardHeader>
            <CardTitle>工具调用循环检测</CardTitle>
            <CardDescription>
              检测模型重复调用同一工具的行为，超过阈值时自动中断请求或注入提示词。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="tool-call-loop-toggle"
                v-model="toolCallLoopEnabled"
              />
              <Label for="tool-call-loop-toggle">
                {{ toolCallLoopEnabled ? '已启用' : '已禁用' }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card class="mt-4">
          <CardHeader>
            <CardTitle>SSE 输出内容循环检测</CardTitle>
            <CardDescription>
              检测流式输出中内容重复循环（N-gram 模式），超过阈值时自动中断流。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="stream-loop-toggle"
                v-model="streamLoopEnabled"
              />
              <Label for="stream-loop-toggle">
                {{ streamLoopEnabled ? '已启用' : '已禁用' }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <div class="flex justify-end mt-4">
          <Button :disabled="saving" @click="handleSave">
            <span v-if="saving" class="flex items-center gap-1">
              <Loader2 class="w-4 h-4 animate-spin" />
              保存中...
            </span>
            <span v-else>保存</span>
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import type { SessionState, SessionHistoryEntry } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ChevronDown, Loader2 } from 'lucide-vue-next'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import SessionTable from '@/components/proxy-enhancement/SessionTable.vue'

const claudeCodeEnabled = ref(false)
const toolCallLoopEnabled = ref(false)
const streamLoopEnabled = ref(false)
const selectModelInstruction = '---\ndescription: 切换代理路由模型\n---\n\n[router-command: select-model $ARGUMENTS]'
const saving = ref(false)
const instructionsOpen = ref(true)

const sessions = ref<SessionState[]>([])
const sessionsLoading = ref(false)
const sessionHistoryMap = ref<Record<string, SessionHistoryEntry[]>>({})

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement()
    claudeCodeEnabled.value = data.claude_code_enabled
    toolCallLoopEnabled.value = data.tool_call_loop_enabled
    streamLoopEnabled.value = data.stream_loop_enabled
  } catch (e: unknown) {
    console.error('Failed to load proxy enhancement config:', e)
    toast.error(getApiMessage(e, '加载配置失败'))
  }
}

async function handleSave() {
  saving.value = true
  try {
    await api.updateProxyEnhancement({
      claude_code_enabled: claudeCodeEnabled.value,
      tool_call_loop_enabled: toolCallLoopEnabled.value,
      stream_loop_enabled: streamLoopEnabled.value,
    })
    toast.success('保存成功')
  } catch (e: unknown) {
    console.error('Failed to save proxy enhancement config:', e)
    toast.error(getApiMessage(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    sessions.value = await api.getSessionStates()
  } catch (e: unknown) {
    console.error('Failed to load sessions:', e)
    toast.error(getApiMessage(e, '加载 Session 列表失败'))
  } finally {
    sessionsLoading.value = false
  }
}

async function handleClearSession(session: SessionState) {
  try {
    await api.deleteSessionState(session.router_key_id, session.session_id)
    toast.success('Session 已清除')
    loadSessions()
  } catch (e: unknown) {
    console.error('Failed to clear session:', e)
    toast.error(getApiMessage(e, '清除 Session 失败'))
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
  } catch (e: unknown) {
    console.error('Failed to load history:', e)
    toast.error(getApiMessage(e, '加载历史记录失败'))
  }
}

onMounted(() => {
  loadConfig()
  loadSessions()
})
</script>
