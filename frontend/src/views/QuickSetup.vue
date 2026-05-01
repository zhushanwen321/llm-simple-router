<template>
  <div class="p-6 space-y-4 pb-20">
    <!-- Row 1: Client+Provider (left) | Connection (right) -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Left: Client & Provider -->
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-sm font-medium">客户端与供应商</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground">本地客户端</Label>
            <ClientSelector v-model="clientType" @update:model-value="selectClient" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">供应商</Label>
              <Select :model-value="selectedGroup" @update:model-value="(v: unknown) => onProviderChange(v as string)">
                <SelectTrigger>
                  <SelectValue placeholder="选择供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="g in providerGroups" :key="g.group" :value="g.group">{{ g.group }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">套餐</Label>
              <Select :model-value="selectedPlan" @update:model-value="(v: unknown) => onPlanChange(v as string)">
                <SelectTrigger>
                  <SelectValue placeholder="选择套餐" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in availablePlans" :key="p.plan" :value="p.plan">{{ p.plan }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Right: Connection -->
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-sm font-medium">连接配置</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">格式</Label>
              <Select v-model="apiType">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">Base URL</Label>
              <Input :model-value="baseUrl" readonly class="font-mono text-xs" />
            </div>
          </div>
          <div class="space-y-1">
            <Label class="text-xs text-muted-foreground">API Key</Label>
            <Input v-model="apiKey" type="password" placeholder="输入 API Key" />
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="connectionStatus === 'testing'" @click="testConnection">
              <template v-if="connectionStatus === 'testing'">
                <svg class="w-3.5 h-3.5 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                测试中...
              </template>
              <template v-else>测试连接</template>
            </Button>
            <Badge v-if="connectionStatus === 'ok'" variant="default" class="bg-green-600 text-white">连接成功</Badge>
            <Badge v-if="connectionStatus === 'error'" variant="destructive">连接失败</Badge>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Model Config (full width) -->
    <Card>
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-sm font-medium">模型配置</CardTitle>
          <Badge variant="secondary" class="text-xs">{{ modelConfigs.length }} 个模型</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-2 gap-3">
          <ModelCard
            v-for="(model, index) in modelConfigs"
            :key="model.name"
            :model="model"
            :api-type="apiType"
            :is-deep-seek="model.name.toLowerCase().includes('deepseek')"
            :is-non-openai-endpoint="isNonOpenaiEndpoint"
            @update:model="updateModel(index, $event)"
            @remove="removeModel(index)"
          />
        </div>
        <p v-if="modelConfigs.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          请先选择供应商与套餐
        </p>
      </CardContent>
    </Card>

    <!-- Row 2: Mappings (left) | Retry rules (right) -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Left: Mappings -->
      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium">模型映射</CardTitle>
            <Badge variant="secondary" class="text-xs">{{ mappingPreview.length }} 条</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <MappingPreview
            :mappings="mappingPreview"
            :available-models="enabledModelNames"
          />
        </CardContent>
      </Card>

      <!-- Right: Retry rules -->
      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium">重试规则</CardTitle>
            <Badge variant="secondary" class="text-xs">{{ selectedRetryRules.size }} 条已选</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="recommendedRules.length === 0" class="py-8 text-center text-sm text-muted-foreground">
            选择供应商后显示推荐规则
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="rule in recommendedRules"
              :key="rule.name"
              class="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                :checked="selectedRetryRules.has(rule.name)"
                @update:checked="(val: boolean | string) => toggleRetryRule(rule.name, !!val)"
                class="mt-0.5"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">{{ rule.name }}</span>
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0 leading-none shrink-0">推荐</Badge>
                </div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  {{ rule.status_code }} · {{ rule.retry_strategy === 'fixed' ? '固定间隔' : '指数退避' }} · {{ rule.retry_delay_ms / 1000 }}s · {{ rule.max_retries }}次
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>

  <!-- Submit bar -->
  <div class="fixed bottom-0 right-0 left-56 border-t bg-card px-6 py-3 flex items-center justify-between z-10">
    <div class="text-sm text-muted-foreground flex items-center gap-1">
      <template v-if="selectedGroup">
        <Badge variant="secondary" class="text-xs">{{ clientTypeLabel }}</Badge>
        <span>/</span>
        <Badge variant="secondary" class="text-xs">{{ selectedGroup }}</Badge>
      </template>
      <template v-if="enabledModelCount > 0">
        <span class="mx-1">·</span>
        <span>{{ enabledModelCount }} 个模型</span>
      </template>
      <template v-if="mappingPreview.length > 0">
        <span class="mx-1">·</span>
        <span>{{ mappingPreview.length }} 条映射</span>
      </template>
      <template v-if="selectedRetryRules.size > 0">
        <span class="mx-1">·</span>
        <span>{{ selectedRetryRules.size }} 条重试规则</span>
      </template>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="outline" @click="validateConfig">验证配置</Button>
      <Button :disabled="saving" @click="submit">
        <template v-if="saving">
          <svg class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          保存中...
        </template>
        <template v-else>保存配置</template>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import { useQuickSetup } from '@/composables/useQuickSetup'
import ClientSelector from '@/components/quick-setup/ClientSelector.vue'
import ModelCard from '@/components/quick-setup/ModelCard.vue'
import MappingPreview from '@/components/quick-setup/MappingPreview.vue'
import type { ModelConfig } from '@/components/quick-setup/types'
import { CLIENTS } from '@/components/quick-setup/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

const {
  clientType, providerGroups, selectedGroup, selectedPlan,
  apiType, apiKey, modelConfigs, mappingPreview,
  recommendedRules, selectedRetryRules, saving, connectionStatus,
  baseUrl, availablePlans, isNonOpenaiEndpoint,
  selectClient, onProviderChange, onPlanChange,
  updateMappings, toggleRetryRule, testConnection, submit,
} = useQuickSetup()

const enabledModelCount = computed(() => modelConfigs.value.filter(m => m.enabled).length)
const enabledModelNames = computed(() => modelConfigs.value.filter(m => m.enabled).map(m => m.name))
const clientTypeLabel = computed(() => CLIENTS.find(c => c.id === clientType.value)?.name ?? clientType.value)

function updateModel(index: number, updated: ModelConfig) {
  const next = [...modelConfigs.value]
  next[index] = updated
  modelConfigs.value = next
  updateMappings()
}

function removeModel(index: number) {
  modelConfigs.value = modelConfigs.value.filter((_, i) => i !== index)
  updateMappings()
}

function validateConfig() {
  if (!selectedGroup.value) { toast.error('请选择供应商'); return }
  if (!apiKey.value.trim()) { toast.error('请填写 API Key'); return }
  if (enabledModelCount.value === 0) { toast.error('至少启用一个模型'); return }
  toast.success('配置验证通过')
}
</script>
