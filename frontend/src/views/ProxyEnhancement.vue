<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-foreground mb-4">{{ t('proxyEnhancement.title') }}</h2>

    <Tabs default-value="dynamic-model">
      <TabsList>
        <TabsTrigger value="dynamic-model">{{ t('proxyEnhancement.tabs.dynamicModel') }}</TabsTrigger>
        <TabsTrigger value="loop-detection">{{ t('proxyEnhancement.tabs.loopDetection') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="dynamic-model">
        <Card>
          <CardHeader>
            <CardTitle>{{ t('proxyEnhancement.dynamicModel.title') }}</CardTitle>
            <CardDescription>
              {{ t('proxyEnhancement.dynamicModel.description') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="claude-code-toggle"
                v-model="claudeCodeEnabled"
              />
              <Label for="claude-code-toggle">
                {{ claudeCodeEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <div class="flex justify-end mt-4">
          <Button :disabled="saving" @click="handleSave">
            <span v-if="saving" class="flex items-center gap-1">
              <Loader2 class="w-4 h-4 animate-spin" />
              {{ t('proxyEnhancement.dynamicModel.saving') }}
            </span>
            <span v-else>{{ t('common.save') }}</span>
          </Button>
        </div>

        <!-- 使用说明 -->
        <Collapsible v-model:open="instructionsOpen" class="mt-4">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full justify-between">
              <span>{{ t('proxyEnhancement.instructions.title') }}</span>
              <ChevronDown class="w-4 h-4 transition-transform" :class="{ 'rotate-180': instructionsOpen }" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="mt-2">
            <Card>
              <CardContent class="space-y-4 text-sm">
                <div>
                  <p class="font-medium text-foreground mb-1 leading-relaxed">{{ t('proxyEnhancement.instructions.config.title') }}</p>
                  <p class="text-muted-foreground leading-relaxed">
                    {{ t('proxyEnhancement.instructions.config.description') }}
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    {{ t('proxyEnhancement.instructions.config.pathProject') }}<br />
                    {{ t('proxyEnhancement.instructions.config.pathGlobal') }}
                  </code>
                  <p class="text-muted-foreground leading-relaxed mt-2">
                    {{ t('proxyEnhancement.instructions.config.contentLabel') }}
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed" v-text="selectModelInstruction" />
                </div>
                <div>
                  <p class="font-medium text-foreground mb-1 leading-relaxed">{{ t('proxyEnhancement.instructions.usage.title') }}</p>
                  <p class="text-muted-foreground leading-relaxed">
                    {{ t('proxyEnhancement.instructions.usage.viewModels') }}
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    /select-model
                  </code>
                  <p class="text-muted-foreground leading-relaxed mt-2">
                    {{ t('proxyEnhancement.instructions.usage.selectModel') }}
                  </p>
                  <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    /select-model provider_name/backend_model
                  </code>
                  <p class="text-muted-foreground leading-relaxed mt-2">
                    {{ t('proxyEnhancement.instructions.usage.verify') }}
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
                <CardTitle>{{ t('proxyEnhancement.sessions.title') }}</CardTitle>
                <CardDescription>{{ t('proxyEnhancement.sessions.description') }}</CardDescription>
              </div>
              <Button variant="outline" size="sm" @click="loadSessions" :disabled="sessionsLoading">{{ t('proxyEnhancement.sessions.refresh') }}</Button>
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
            <CardTitle>{{ t('proxyEnhancement.loopDetection.toolRoundLimit.title') }}</CardTitle>
            <CardDescription>
              {{ t('proxyEnhancement.loopDetection.toolRoundLimit.description') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="tool-round-limit-toggle"
                v-model="toolRoundLimitEnabled"
              />
              <Label for="tool-round-limit-toggle">
                {{ toolRoundLimitEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card class="mt-4">
          <CardHeader>
            <CardTitle>{{ t('proxyEnhancement.loopDetection.toolCallLoop.title') }}</CardTitle>
            <CardDescription>
              {{ t('proxyEnhancement.loopDetection.toolCallLoop.description') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="tool-call-loop-toggle"
                v-model="toolCallLoopEnabled"
              />
              <Label for="tool-call-loop-toggle">
                {{ toolCallLoopEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card class="mt-4">
          <CardHeader>
            <CardTitle>{{ t('proxyEnhancement.loopDetection.streamLoop.title') }}</CardTitle>
            <CardDescription>
              {{ t('proxyEnhancement.loopDetection.streamLoop.description') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3">
              <Switch
                id="stream-loop-toggle"
                v-model="streamLoopEnabled"
              />
              <Label for="stream-loop-toggle">
                {{ streamLoopEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
              </Label>
            </div>
          </CardContent>
        </Card>

        <div class="flex justify-end mt-4">
          <Button :disabled="saving" @click="handleSave">
            <span v-if="saving" class="flex items-center gap-1">
              <Loader2 class="w-4 h-4 animate-spin" />
              {{ t('proxyEnhancement.dynamicModel.saving') }}
            </span>
            <span v-else>{{ t('common.save') }}</span>
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
const claudeCodeEnabled = ref(false)
const toolRoundLimitEnabled = ref(true)
const toolCallLoopEnabled = ref(false)
const streamLoopEnabled = ref(false)
const selectModelInstruction = '---\ndescription: ' + t('proxyEnhancement.instructions.config.title') + '\n---\n\n[router-command: select-model $ARGUMENTS]'
const saving = ref(false)
const instructionsOpen = ref(true)

const sessions = ref<SessionState[]>([])
const sessionsLoading = ref(false)
const sessionHistoryMap = ref<Record<string, SessionHistoryEntry[]>>({})

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement()
    claudeCodeEnabled.value = data.claude_code_enabled
    toolRoundLimitEnabled.value = data.tool_round_limit_enabled
    toolCallLoopEnabled.value = data.tool_call_loop_enabled
    streamLoopEnabled.value = data.stream_loop_enabled
  } catch (e: unknown) {
    console.error('Failed to load proxy enhancement config:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.loadFailed')))
  }
}

async function handleSave() {
  saving.value = true
  try {
    await api.updateProxyEnhancement({
      claude_code_enabled: claudeCodeEnabled.value,
      tool_call_loop_enabled: toolCallLoopEnabled.value,
      stream_loop_enabled: streamLoopEnabled.value,
      tool_round_limit_enabled: toolRoundLimitEnabled.value,
    })
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    console.error('Failed to save proxy enhancement config:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.saveFailed')))
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
    toast.error(getApiMessage(e, t('proxyEnhancement.sessions.loadFailed')))
  } finally {
    sessionsLoading.value = false
  }
}

async function handleClearSession(session: SessionState) {
  try {
    await api.deleteSessionState(session.router_key_id, session.session_id)
    toast.success(t('proxyEnhancement.sessions.clearSuccess'))
    loadSessions()
  } catch (e: unknown) {
    console.error('Failed to clear session:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.sessions.clearFailed')))
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
    toast.error(getApiMessage(e, t('proxyEnhancement.sessions.loadHistoryFailed')))
  }
}

onMounted(() => {
  loadConfig()
  loadSessions()
})
</script>
