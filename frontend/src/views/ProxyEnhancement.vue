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
            :checked="claudeCodeEnabled"
            @update:checked="claudeCodeEnabled = $event"
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
          <CardContent class="pt-6 space-y-4 text-sm">
            <div>
              <p class="font-medium text-foreground mb-1">内联指令切换模型</p>
              <p class="text-muted-foreground">
                在消息开头添加指令，单次切换使用的模型：
              </p>
              <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono">
                $SELECT-MODEL=claude-sonnet-4-20250514 你的问题内容
              </code>
            </div>
            <div>
              <p class="font-medium text-foreground mb-1">交互式选择模型</p>
              <p class="text-muted-foreground">
                发送命令进入交互式模型选择：
              </p>
              <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono">
                /select-model
              </code>
            </div>
            <div>
              <p class="font-medium text-foreground mb-1">恢复默认模型</p>
              <p class="text-muted-foreground">
                切回路由默认映射的模型：
              </p>
              <code class="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono">
                $SELECT-MODEL=default
              </code>
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'

const claudeCodeEnabled = ref(false)
const saving = ref(false)
const instructionsOpen = ref(false)

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

onMounted(loadConfig)
</script>
