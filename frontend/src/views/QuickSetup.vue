<template>
  <div class="p-6 space-y-4 pb-20">
    <!-- Row 1: Client Selection -->
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-sm font-medium">选择客户端</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="c in CLIENTS"
            :key="c.id"
            class="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm transition-all cursor-pointer"
            :class="clientType === c.id
              ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary/20'
              : 'border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground'"
            @click="selectClient(c.id)"
          >
            <span
              class="w-7 h-7 rounded-md text-xs font-bold flex items-center justify-center shrink-0"
              :class="{
                'bg-purple-600 text-white': c.iconClass === 'cc',
                'bg-emerald-600 text-white': c.iconClass === 'pi',
                'bg-blue-600 text-white': c.iconClass === 'oa',
                'bg-orange-600 text-white': c.iconClass === 'an',
              }"
            >{{ c.icon }}</span>
            <div class="text-left">
              <div class="font-medium text-sm leading-tight">{{ c.name }}</div>
              <div class="text-[10px] opacity-60 leading-tight">{{ c.format }} · {{ c.description }}</div>
            </div>
          </button>
        </div>
      </CardContent>
    </Card>

    <!-- Row 2: Provider Config -->
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-sm font-medium">供应商配置</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Line 1: Provider / Plan / Format / BaseURL / APIKey -->
        <div class="flex items-end gap-2">
          <div class="w-40 space-y-1">
            <Label class="text-xs text-muted-foreground">供应商</Label>
            <Select :model-value="selectedGroup" @update:model-value="(v: unknown) => onProviderChange(v as string)">
              <SelectTrigger class="w-full"><SelectValue placeholder="选择" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__">自定义</SelectItem>
                <SelectItem v-for="g in providerGroups" :key="g.group" :value="g.group">{{ g.group }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <!-- Custom mode: show format + editable base url -->
          <template v-if="isCustomProvider">
            <div class="w-28 space-y-1">
              <Label class="text-xs text-muted-foreground">格式</Label>
              <Select v-model="apiType">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="w-80 space-y-1">
              <Label class="text-xs text-muted-foreground">Base URL</Label>
              <Input v-model="customBaseUrl" placeholder="https://api.example.com/v1" class="font-mono text-xs" />
            </div>
          </template>
          <!-- Preset mode: show plan + readonly base url -->
          <template v-else>
            <div class="w-28 space-y-1">
              <Label class="text-xs text-muted-foreground">套餐</Label>
              <Select :model-value="selectedPlan" @update:model-value="(v: unknown) => onPlanChange(v as string)">
                <SelectTrigger class="w-full"><SelectValue placeholder="选择" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in availablePlans" :key="p.plan" :value="p.plan">{{ p.plan }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="w-28 space-y-1">
              <Label class="text-xs text-muted-foreground">格式</Label>
              <Select v-model="apiType">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="w-80 space-y-1">
              <Label class="text-xs text-muted-foreground">Base URL</Label>
              <Input :model-value="baseUrl" readonly class="font-mono text-xs" />
            </div>
          </template>
          <div class="w-64 space-y-1">
            <Label class="text-xs text-muted-foreground">API Key</Label>
            <Input v-model="apiKey" type="password" placeholder="输入 API Key" />
          </div>
          <div class="shrink-0 space-y-1">
            <Label class="text-xs text-muted-foreground invisible">连接</Label>
            <Button variant="outline" size="sm" :disabled="connectionStatus === 'testing'" @click="testConnection">
              <template v-if="connectionStatus === 'testing'">
                <svg class="w-3.5 h-3.5 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                测试中
              </template>
              <template v-else-if="connectionStatus === 'ok'">已连接</template>
              <template v-else>测试</template>
            </Button>
          </div>
        </div>

        <!-- Line 2: Model Cards -->
        <div class="border-t pt-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-muted-foreground">模型配置</span>
            <Badge variant="secondary" class="text-[10px]">{{ enabledModelCount }}/{{ modelConfigs.length }}</Badge>
          </div>
          <p v-if="modelConfigs.length === 0" class="py-4 text-center text-xs text-muted-foreground">
            请先选择供应商与套餐
          </p>
          <div v-else class="grid grid-cols-4 gap-2">
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
          <!-- Custom mode: add model input -->
          <div v-if="isCustomProvider" class="flex gap-2 mt-2">
            <Input v-model="customModelInput" placeholder="输入模型名称" @keydown.enter.prevent="handleAddCustomModel" class="flex-1" />
            <Button type="button" variant="outline" size="sm" @click="handleAddCustomModel" :disabled="!customModelInput.trim()">添加</Button>
          </div>
        </div>

        <!-- Line 3: Concurrency Control -->
        <div class="border-t pt-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-muted-foreground">并发控制</span>
          </div>
          <ConcurrencyControl
            :mode="concurrencyMode"
            :max-concurrency="maxConcurrency"
            :queue-timeout-ms="queueTimeoutMs"
            :max-queue-size="maxQueueSize"
            @update:mode="onConcurrencyModeChange"
            @update:max-concurrency="maxConcurrency = $event"
            @update:queue-timeout-ms="queueTimeoutMs = $event"
            @update:max-queue-size="maxQueueSize = $event"
          />
        </div>
      </CardContent>
    </Card>

    <!-- Row 3: Mappings + Retry rules -->
    <div class="grid grid-cols-5 gap-4">
      <!-- Left: Mappings -->
      <Card class="col-span-3">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium">模型映射</CardTitle>
            <Badge variant="secondary" class="text-[10px]">{{ mappingEntries.length }} 条</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <MappingList
            :entries="mappingEntries"
            :provider-groups="allProviderGroups"
            :show-delete="false"
            :show-add-form="true"
            @update:targets="updateMappingTargets"
            @toggle-active="toggleMappingActive"
            @add="addMappingEntry"
            @remove="removeMappingEntry"
          />
        </CardContent>
      </Card>

      <!-- Right: Retry Rules + Transform Rules -->
      <div class="col-span-2 space-y-4">
        <Card>
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm font-medium">重试规则</CardTitle>
              <Badge variant="secondary" class="text-[10px]">{{ selectedRetryRules.size }} 条已选</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div v-if="recommendedRules.length === 0" class="py-6 text-center text-xs text-muted-foreground">
              <template v-if="allRecommendedRules.length === 0">
                所有推荐规则已创建，无需重复添加
              </template>
              <template v-else>
                选择供应商后显示推荐规则
              </template>
            </div>
            <div v-else class="space-y-1.5 max-h-[320px] overflow-y-auto">
              <div
                v-for="rule in recommendedRules"
                :key="rule.name"
                class="flex items-start gap-2.5 rounded-md transition-colors"
                :class="rule.exists
                  ? 'opacity-60 cursor-default p-2'
                  : 'hover:bg-muted/50 cursor-pointer p-2'"
                @click="!rule.exists && toggleRetryRule(rule.name, !selectedRetryRules.has(rule.name))"
              >
                <Checkbox
                  :checked="rule.exists ? true : selectedRetryRules.has(rule.name)"
                  :disabled="rule.exists"
                  class="mt-0.5"
                  @update:checked="(val: boolean | string) => toggleRetryRule(rule.name, !!val)"
                  @click.stop
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-medium">{{ rule.name }}</span>
                    <Badge v-if="rule.exists" variant="secondary" class="text-[9px] px-1.5 py-0 leading-none bg-muted text-muted-foreground">已配置</Badge>
                    <Badge v-else-if="rule.providers && rule.providers.length > 0" variant="outline" class="text-[9px] px-1 py-0 leading-none">{{ rule.providers[0] }}</Badge>
                    <Badge v-else variant="secondary" class="text-[9px] px-1 py-0 leading-none">通用</Badge>
                  </div>
                  <div class="text-[10px] text-muted-foreground mt-0.5">
                    {{ rule.status_code }} · {{ rule.retry_strategy === 'fixed' ? '固定' : '指数退避' }} · {{ rule.retry_delay_ms / 1000 }}s · {{ rule.max_retries }}次
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Transform Rules -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm font-medium">转换规则</CardTitle>
          </CardHeader>
          <CardContent>
            <TransformRulesForm
              :inject-headers="transformInjectHeaders"
              :drop-fields="transformDropFields"
              :request-defaults="transformRequestDefaults"
              @update:inject-headers="transformInjectHeaders = $event"
              @update:drop-fields="transformDropFields = $event"
              @update:request-defaults="transformRequestDefaults = $event"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  </div>

  <!-- Submit bar -->
  <div class="fixed bottom-0 right-0 left-56 border-t bg-card/95 backdrop-blur px-6 py-2.5 flex items-center justify-between z-10">
    <div class="text-xs text-muted-foreground flex items-center gap-1.5">
      <template v-if="selectedGroup">
        <Badge variant="secondary" class="text-[10px]">{{ clientTypeLabel }}</Badge>
        <span class="text-muted-foreground/50">→</span>
        <Badge variant="secondary" class="text-[10px]">{{ isCustomProvider ? '自定义' : selectedGroup }}</Badge>
      </template>
      <template v-if="enabledModelCount > 0">
        <span class="text-muted-foreground/50 mx-0.5">·</span>
        <span>{{ enabledModelCount }} 模型</span>
      </template>
      <template v-if="mappingEntries.length > 0">
        <span class="text-muted-foreground/50 mx-0.5">·</span>
        <span>{{ mappingEntries.length }} 映射</span>
      </template>
      <template v-if="selectedRetryRules.size > 0">
        <span class="text-muted-foreground/50 mx-0.5">·</span>
        <span>{{ selectedRetryRules.size }} 规则</span>
      </template>
    </div>
    <div class="flex items-center gap-2">
      <Button size="sm" variant="outline" @click="validateConfig">验证</Button>
      <Button size="sm" :disabled="saving" @click="submit">
        <template v-if="saving">
          <svg class="w-3.5 h-3.5 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          保存中
        </template>
        <template v-else>保存配置</template>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { useQuickSetup, type ConcurrencyMode } from '@/composables/useQuickSetup'
import ModelCard from '@/components/quick-setup/ModelCard.vue'
import MappingList from '@/components/shared/MappingList.vue'
import ConcurrencyControl from '@/components/shared/ConcurrencyControl.vue'
import TransformRulesForm from '@/components/shared/TransformRulesForm.vue'
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
  apiType, apiKey, modelConfigs, mappingEntries,
  allRecommendedRules, recommendedRules,
  selectedRetryRules, saving, connectionStatus,
  baseUrl, availablePlans, isNonOpenaiEndpoint,
  isCustomProvider, customBaseUrl,
  concurrencyMode, maxConcurrency, queueTimeoutMs, maxQueueSize,
  allProviderGroups,
  transformInjectHeaders, transformDropFields, transformRequestDefaults,
  selectClient, onProviderChange, onPlanChange,
  updateMappingTargets, toggleMappingActive, addMappingEntry, removeMappingEntry,
  toggleRetryRule, onConcurrencyModeChange, testConnection, submit,
  addCustomModel,
} = useQuickSetup()

const customModelInput = ref('')

function handleAddCustomModel() {
  if (!customModelInput.value.trim()) return
  addCustomModel(customModelInput.value.trim())
  customModelInput.value = ''
}

const enabledModelCount = computed(() => modelConfigs.value.filter(m => m.enabled).length)
const clientTypeLabel = computed(() => CLIENTS.find(c => c.id === clientType.value)?.name ?? clientType.value)

function updateModel(index: number, updated: ModelConfig) {
  const next = [...modelConfigs.value]
  next[index] = updated
  modelConfigs.value = next
}

function removeModel(index: number) {
  modelConfigs.value = modelConfigs.value.filter((_, i) => i !== index)
}

function validateConfig() {
  if (!selectedGroup.value) { toast.error('请选择供应商'); return }
  if (!apiKey.value.trim()) { toast.error('请填写 API Key'); return }
  if (enabledModelCount.value === 0) { toast.error('至少启用一个模型'); return }
  toast.success('配置验证通过')
}
</script>
