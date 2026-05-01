<template>
  <div class="p-6 space-y-6 pb-24">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-foreground">快速配置</h2>
    </div>

    <!-- Section 1: 选择客户端与供应商 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm font-medium">选择客户端与供应商</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <ClientSelector v-model="clientType" @update:model-value="selectClient" />
        <div class="flex items-start gap-3">
          <div class="flex-1 space-y-1">
            <Label class="text-xs text-muted-foreground">供应商</Label>
            <Select v-model="selectedGroup" @update:model-value="(v: unknown) => onProviderChange(v as string)">
              <SelectTrigger>
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="g in providerGroups" :key="g.group" :value="g.group">{{ g.group }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex-1 space-y-1">
            <Label class="text-xs text-muted-foreground">套餐</Label>
            <Select v-model="selectedPlan" @update:model-value="(v: unknown) => onPlanChange(v as string)">
              <SelectTrigger>
                <SelectValue placeholder="选择套餐" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in availablePlans" :key="p.plan" :value="p.plan">{{ p.plan }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex-1 space-y-1">
            <Label class="text-xs text-muted-foreground">格式</Label>
            <Input :model-value="apiType" disabled class="opacity-60 bg-muted" />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Section 2: 连接配置 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm font-medium">连接配置</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="space-y-1">
          <Label class="text-xs text-muted-foreground">Base URL</Label>
          <Input :model-value="baseUrl" readonly disabled class="opacity-60 bg-muted font-mono text-xs" />
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
          <Badge
            v-if="connectionStatus === 'ok'"
            variant="default"
            class="bg-green-600 text-white"
          >连接成功</Badge>
          <Badge
            v-if="connectionStatus === 'error'"
            variant="destructive"
          >连接失败</Badge>
        </div>
      </CardContent>
    </Card>

    <!-- Section 3: 模型配置 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm font-medium">模型配置</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
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
        <p v-if="modelConfigs.length === 0" class="py-4 text-center text-sm text-muted-foreground">
          请先选择供应商与套餐
        </p>
      </CardContent>
    </Card>

    <!-- Section 4: 模型映射 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm font-medium">模型映射</CardTitle>
      </CardHeader>
      <CardContent>
        <MappingPreview
          :mappings="mappingPreview"
          :available-models="enabledModelNames"
        />
      </CardContent>
    </Card>

    <!-- Section 5: 重试规则 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm font-medium">重试规则</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-10"></TableHead>
              <TableHead>名称</TableHead>
              <TableHead>状态码</TableHead>
              <TableHead>匹配模式</TableHead>
              <TableHead>策略</TableHead>
              <TableHead>详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="rule in recommendedRules" :key="rule.name">
              <TableCell>
                <Checkbox
                  :checked="selectedRetryRules.has(rule.name)"
                  @update:checked="(val: boolean | string) => toggleRetryRule(rule.name, !!val)"
                />
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-1">
                  <span class="font-medium">{{ rule.name }}</span>
                  <Badge variant="outline" class="text-[10px] px-1 py-0 leading-none">推荐</Badge>
                </div>
              </TableCell>
              <TableCell>{{ rule.status_code }}</TableCell>
              <TableCell class="font-mono text-xs max-w-[200px] truncate text-muted-foreground">{{ rule.body_pattern }}</TableCell>
              <TableCell>
                <Badge variant="secondary">{{ rule.retry_strategy === 'fixed' ? '固定间隔' : '指数退避' }}</Badge>
              </TableCell>
              <TableCell class="text-xs text-muted-foreground">
                {{ rule.retry_delay_ms / 1000 }}s · {{ rule.max_retries }}次
                <template v-if="rule.retry_strategy === 'exponential'"> · 上限{{ rule.max_delay_ms / 1000 }}s</template>
              </TableCell>
            </TableRow>
            <TableRow v-if="recommendedRules.length === 0">
              <TableCell colspan="6" class="text-center text-muted-foreground py-8">暂无推荐规则</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import {
  CLIENTS,
} from '@/components/quick-setup/types'

const {
  clientType, providerGroups, selectedGroup, selectedPlan,
  apiKey, modelConfigs, mappingPreview, recommendedRules,
  selectedRetryRules, saving, connectionStatus,
  apiType, baseUrl, availablePlans, isNonOpenaiEndpoint,
  selectClient, onProviderChange, onPlanChange,
  updateMappings, toggleRetryRule, testConnection, submit,
} = useQuickSetup()

const enabledModelCount = computed(() => modelConfigs.value.filter(m => m.enabled).length)

const enabledModelNames = computed(() =>
  modelConfigs.value.filter(m => m.enabled).map(m => m.name),
)

const clientTypeLabel = computed(() => {
  const client = CLIENTS.find(c => c.id === clientType.value)
  return client?.name ?? clientType.value
})

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
  if (!selectedGroup.value) {
    toast.error('请选择供应商')
    return
  }
  if (!apiKey.value.trim()) {
    toast.error('请填写 API Key')
    return
  }
  if (enabledModelCount.value === 0) {
    toast.error('至少启用一个模型')
    return
  }
  toast.success('配置验证通过')
}
</script>
