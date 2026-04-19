<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">代理增强</h2>
      <Button :disabled="saving" @click="handleSave">
        <span v-if="saving" class="flex items-center gap-1">
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          保存中...
        </span>
        <span v-else>保存</span>
      </Button>
    </div>

    <Tabs default-value="claude-code">
      <TabsList>
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
        <TabsTrigger value="opencode">OpenCode</TabsTrigger>
      </TabsList>
      <TabsContent value="claude-code">
        <Card>
          <CardHeader>
            <CardTitle>Claude Code 动态模型切换</CardTitle>
            <CardDescription>
              启用后，Claude Code 客户端可在对话中通过指令动态切换后端模型，无需修改路由配置。
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

        <!-- 使用说明 -->
        <Collapsible v-model:open="instructionsOpen" class="mt-4">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full justify-between">
              <span>使用说明</span>
              <svg
                class="w-4 h-4 transition-transform"
                :class="{ 'rotate-180': instructionsOpen }"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="mt-2">
            <Card>
              <CardContent class="space-y-4 text-sm">
                <div>
                  <p class="font-medium text-foreground mb-1 leading-relaxed">配置方法</p>
                  <p class="text-muted-foreground leading-relaxed">
                    创建一个 Claude Code 的 Command ，内容是 
                  </p>
	                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed" v-text="selectModelInstruction" />
                </div>
                <div>
                  <p class="text-muted-foreground leading-relaxed">
                    Command 可以是项目级或者全局级
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    # 项目级 Command <br />
                    .claude/commands/select-model.md
                  </code>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    # 全局级 Command <br />
                    ~/.claude/commands/select-model.md
                  </code>
                </div>
                <div>
                  <p class="font-medium text-foreground mb-1 leading-relaxed">使用方法</p>
                  <div>
                    <p class="text-muted-foreground leading-relaxed">
                      在 Claude Code 中查看可用模型
                    </p>
                    <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      # 输入命令  <br />
                      /select-model
                    </code>
                    <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      # 得到结果是你在供应商配置的 provider/model 列表 <br />
                      1. zai-coding-plan/glm-5 <br />
                      2. zai-coding-plan/glm-5.1 <br />
                      3. zai-coding-plan/glm-5-turbo <br />
                      4. kimi-coding-plan/kimi-for-coding <br />
                    </code>
                  </div>
                  <div>
                    <p class="text-muted-foreground leading-relaxed">
                      在Claude Code 中选择模型
                    </p>
                    <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      # 输入命令 <br />
                      /select-model zai-coding-plan/glm-5.1
                    </code>
                    <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      # 得到结果 <br />
                      已选择模型: zai-coding-plan/glm-5.1
                    </code>
                    <p class="text-muted-foreground leading-relaxed">
                      之后可以在 活跃 Session 中查看模型设置情况。在 请求日志 页面查看请求是否已经路由到了已选择模型。
                    </p>
                  </div>
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
      <TabsContent value="opencode">
        <div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p class="text-lg">暂未支持 OpenCode 增强</p>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import type { SessionState, SessionHistoryEntry } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import SessionTable from '@/components/proxy-enhancement/SessionTable.vue'

const claudeCodeEnabled = ref(false)
const selectModelInstruction = '[router-command: select-model $ARGUMENTS]'
const saving = ref(false)
const instructionsOpen = ref(true)

const sessions = ref<SessionState[]>([])
const sessionsLoading = ref(false)
const sessionHistoryMap = ref<Record<string, SessionHistoryEntry[]>>({})

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement()
    claudeCodeEnabled.value = data.claude_code_enabled
  } catch (e) {
    console.error('Failed to load proxy enhancement config:', e)
    toast.error('加载配置失败')
  }
}

async function handleSave() {
  saving.value = true
  try {
    await api.updateProxyEnhancement({ claude_code_enabled: claudeCodeEnabled.value })
    toast.success('保存成功')
  } catch (e) {
    console.error('Failed to save proxy enhancement config:', e)
    toast.error('保存失败')
  } finally {
    saving.value = false
  }
}

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

onMounted(() => {
  loadConfig()
  loadSessions()
})
</script>
