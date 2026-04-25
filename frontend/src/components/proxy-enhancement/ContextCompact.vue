<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle>1M 上下文压缩</CardTitle>
        <CardDescription>
          当对话接近模型上下文窗口上限时，自动使用大窗口模型压缩历史消息，避免上下文溢出导致的请求失败。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="w-4 h-4 animate-spin" />
          加载中...
        </div>
        <div v-else class="flex items-center gap-3">
          <Switch id="context-compact-toggle" v-model="enabled" />
          <Label for="context-compact-toggle">
            {{ enabled ? '已启用' : '已禁用' }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <!-- 使用说明 -->
    <Collapsible v-model:open="instructionsOpen">
      <CollapsibleTrigger as-child>
        <Button variant="ghost" class="w-full justify-between">
          <span>使用说明</span>
          <ChevronDown class="w-4 h-4 transition-transform" :class="{ 'rotate-180': instructionsOpen }" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent class="mt-2">
        <Card>
          <CardContent class="space-y-3 text-sm">
            <div>
              <p class="font-medium text-foreground mb-1 leading-relaxed">功能说明</p>
              <p class="text-muted-foreground leading-relaxed">
                当客户端请求的 token 数接近模型上下文窗口上限时，路由器会自动将对话历史发送给压缩模型，生成精简摘要后替代原始历史继续对话。
              </p>
            </div>
            <div>
              <p class="font-medium text-foreground mb-1 leading-relaxed">使用方法</p>
              <p class="text-muted-foreground leading-relaxed">
                在下方选择一个上下文窗口 >= 1M tokens 的模型作为压缩模型。启用后无需额外操作，路由器会在需要时自动触发压缩。
              </p>
            </div>
            <div>
              <p class="font-medium text-foreground mb-1 leading-relaxed">前提条件</p>
              <p class="text-muted-foreground leading-relaxed">
                需要在「供应商管理」中至少配置一个提供 >= 1M 上下文窗口模型的供应商，且该供应商处于启用状态。
              </p>
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>

    <!-- 压缩模型配置 -->
    <Card>
      <CardHeader>
        <CardTitle>压缩模型</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">供应商</Label>
            <Select v-model="selectedProviderId" @update:model-value="onProviderChange">
              <SelectTrigger>
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in providerOptions" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">模型</Label>
            <Select v-model="selectedModel" :disabled="!selectedProviderId">
              <SelectTrigger>
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="m in filteredModels" :key="m.model" :value="m.model">
                  {{ m.model }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p v-if="compactModels.length === 0" class="text-sm text-muted-foreground">
          未找到上下文窗口 >= 1M tokens 的模型，请先在供应商管理中配置。
        </p>
      </CardContent>
    </Card>

    <!-- 自定义压缩提示词 -->
    <Card>
      <CardHeader>
        <CardTitle>自定义压缩提示词</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-3">
          <Switch id="custom-prompt-toggle" v-model="customPromptEnabled" />
          <Label for="custom-prompt-toggle">
            {{ customPromptEnabled ? '使用自定义提示词' : '使用默认提示词' }}
          </Label>
        </div>

        <div v-if="customPromptEnabled" class="space-y-3">
          <Textarea
            v-model="customPrompt"
            :rows="12"
            class="font-mono text-xs"
            placeholder="输入自定义压缩提示词..."
          />
          <Button variant="outline" size="sm" @click="resetPrompt">
            一键还原到默认提示词
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 保存按钮 -->
    <div class="flex justify-end">
      <Button :disabled="saving" @click="handleSave">
        <span v-if="saving" class="flex items-center gap-1">
          <Loader2 class="w-4 h-4 animate-spin" />
          保存中...
        </span>
        <span v-else>保存</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api, getApiMessage, type CompactModelEntry } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ChevronDown, Loader2 } from 'lucide-vue-next'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const enabled = ref(false)
const saving = ref(false)
const loading = ref(true)
const instructionsOpen = ref(false)
const selectedProviderId = ref<string | undefined>(undefined)
const selectedModel = ref<string | undefined>(undefined)
const customPromptEnabled = ref(false)
const customPrompt = ref('')
const defaultPrompt = ref('')
const compactModels = ref<CompactModelEntry[]>([])

// 去重后的供应商选项
const providerOptions = computed(() => {
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []
  for (const m of compactModels.value) {
    if (!seen.has(m.provider_id)) {
      seen.add(m.provider_id)
      result.push({ id: m.provider_id, name: m.provider_name })
    }
  }
  return result
})

// 按选中供应商过滤模型
const filteredModels = computed(() =>
  compactModels.value.filter(m => m.provider_id === selectedProviderId.value),
)

function onProviderChange() {
  // 切换供应商时清空已选模型，避免选到不存在的模型
  selectedModel.value = undefined
}

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement()
    enabled.value = data.context_compact_enabled
    selectedProviderId.value = data.compact_provider_id ?? undefined
    selectedModel.value = data.compact_model ?? undefined
    customPromptEnabled.value = data.custom_prompt_enabled
    customPrompt.value = data.custom_prompt ?? ''
    defaultPrompt.value = data.default_compact_prompt ?? ''
  } catch (e: unknown) {
    console.error('Failed to load context compact config:', e)
    toast.error(getApiMessage(e, '加载配置失败'))
  }
}

async function loadCompactModels() {
  try {
    compactModels.value = await api.getCompactModels()
  } catch (e: unknown) {
    console.error('Failed to load compact models:', e)
    toast.error(getApiMessage(e, '加载压缩模型列表失败'))
  }
}

// 开启自定义提示词时，若内容为空则自动填充默认提示词
watch(customPromptEnabled, (enabled) => {
  if (enabled && !customPrompt.value && defaultPrompt.value) {
    customPrompt.value = defaultPrompt.value
  }
})

function resetPrompt() {
  customPrompt.value = defaultPrompt.value
}

async function handleSave() {
  saving.value = true
  try {
    // PUT 请求需要发送完整的 proxy-enhancement 配置
    // 先读取最新配置以确保 claude_code_enabled 不被覆盖
    const current = await api.getProxyEnhancement()
    await api.updateProxyEnhancement({
      claude_code_enabled: current.claude_code_enabled,
      context_compact_enabled: enabled.value,
      compact_provider_id: selectedProviderId.value ?? null,
      compact_model: selectedModel.value ?? null,
      custom_prompt_enabled: customPromptEnabled.value,
      custom_prompt: customPromptEnabled.value ? customPrompt.value : null,
    })
    toast.success('保存成功')
  } catch (e: unknown) {
    console.error('Failed to save context compact config:', e)
    toast.error(getApiMessage(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.allSettled([loadConfig(), loadCompactModels()])
  loading.value = false
})
</script>
