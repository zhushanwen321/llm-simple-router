<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">模型映射</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        添加分组
      </Button>
    </div>

    <div class="space-y-4">
      <Card v-for="g in groupsWithParsedRule" :key="g.id">
        <Collapsible :default-open="false">
          <CardHeader class="flex flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <CardTitle class="font-mono text-sm">{{ g.client_model }}</CardTitle>
              <Badge variant="secondary">{{ g.strategy }}</Badge>
            </div>
            <div class="flex items-center gap-2">
              <CollapsibleTrigger as-child>
                <Button variant="ghost" size="sm">
                  展开
                </Button>
              </CollapsibleTrigger>
              <Button variant="ghost" size="sm" @click="openEdit(g)">编辑</Button>
              <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="deleteTarget = g">删除</Button>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div v-if="g.strategy === 'scheduled'" class="space-y-3">
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-muted-foreground">默认模型:</span>
                  <span class="font-mono">{{ g.parsedRule.default?.backend_model || '-' }}</span>
                  <span class="text-muted-foreground">/</span>
                  <span>{{ providerNameMap.get(g.parsedRule.default?.provider_id || '') || '-' }}</span>
                </div>
                <div v-if="g.parsedRule.windows?.length" class="space-y-2">
                  <div class="text-sm text-muted-foreground">时间窗口</div>
                  <div
                    v-for="(w, idx) in g.parsedRule.windows"
                    :key="idx"
                    class="flex items-center gap-2 text-sm"
                  >
                    <span class="font-mono text-xs bg-muted px-2 py-0.5 rounded">{{ w.start }} - {{ w.end }}</span>
                    <span class="font-mono">{{ w.target.backend_model }}</span>
                    <span class="text-muted-foreground">/</span>
                    <span>{{ providerNameMap.get(w.target.provider_id) || w.target.provider_id }}</span>
                  </div>
                </div>
                <div v-else class="text-sm text-muted-foreground">无时间窗口</div>
              </div>
              <div v-else class="space-y-2">
                <div v-for="(t, idx) in (g.parsedRule.targets || [])" :key="idx" class="flex items-center gap-2 text-sm">
                  <span v-if="g.strategy === 'failover'" class="text-muted-foreground text-xs">{{ idx + 1 }}.</span>
                  <span class="font-mono">{{ t.backend_model }}</span>
                  <span class="text-muted-foreground">/</span>
                  <span>{{ providerNameMap.get(t.provider_id) || t.provider_id }}</span>
                </div>
                <div v-if="!(g.parsedRule.targets || []).length" class="text-sm text-muted-foreground">无目标</div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <div v-if="groups.length === 0" class="text-center text-muted-foreground py-12 bg-card rounded-xl border">
        暂无映射分组
      </div>
    </div>

    <MappingGroupFormDialog
      v-model:open="dialogOpen"
      :editing-id="editingId"
      :form="form"
      :providers="providersList"
      :provider-models="providerModelsMap"
      @save="handleSave"
      @add-window="addWindow"
      @remove-window="removeWindow"
      @add-target="addTarget"
      @remove-target="removeTarget"
      @move-target-up="moveTargetUp"
      @move-target-down="moveTargetDown"
    />

    <MappingGroupDeleteDialog
      :target="deleteTarget"
      @confirm="handleDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import MappingGroupFormDialog from '@/components/mappings/MappingGroupFormDialog.vue'
import MappingGroupDeleteDialog from '@/components/mappings/MappingGroupDeleteDialog.vue'

interface MappingGroup {
  id: string
  client_model: string
  strategy: string
  rule: string
  created_at: string
}

interface Provider {
  id: string
  name: string
}

interface RuleWindow {
  start: string
  end: string
  target: {
    backend_model: string
    provider_id: string
  }
}

interface Rule {
  default?: { backend_model: string; provider_id: string }
  windows?: RuleWindow[]
  targets?: { backend_model: string; provider_id: string }[]
}

const DEFAULT_FORM = {
  client_model: '',
  strategy: 'scheduled',
  default: { backend_model: '', provider_id: '' },
  windows: [] as RuleWindow[],
  targets: [] as { backend_model: string; provider_id: string }[],
}

const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<MappingGroup | null>(null)
const form = ref({ ...DEFAULT_FORM })

const providerNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const p of providersList.value) map.set(p.id, p.name)
  return map
})

// 从供应商的 models 字段获取可用模型列表
const providerModelsMap = computed(() => {
  const map = new Map<string, string[]>()
  for (const p of providersList.value) {
    const models = (p as Provider & { models?: string[] }).models
    if (Array.isArray(models) && models.length > 0) {
      map.set(p.id, [...models])
    }
  }
  return map
})

// 预解析 rule，避免模板中重复调用 parsedRule()
const groupsWithParsedRule = computed(() =>
  groups.value.map((g) => {
    let parsedRule: Rule = {}
    try {
      parsedRule = JSON.parse(g.rule) as Rule
    // eslint-disable-next-line taste/no-silent-catch -- computed 中无法传播异常，使用空默认值
    } catch {
      // rule 格式异常时使用空默认值
    }
    return { ...g, parsedRule }
  })
)

async function loadData() {
  const results = await Promise.allSettled([
    api.getMappingGroups(),
    api.getProviders(),
  ])
  if (results[0].status === 'fulfilled') {
    groups.value = results[0].value.data
  } else {
    console.error('Failed to load groups:', results[0].reason)
  }
  if (results[1].status === 'fulfilled') {
    providersList.value = results[1].value as Provider[]
  } else {
    console.error('Failed to load providers:', results[1].reason)
    toast.error('加载供应商失败')
  }
}

function openCreate() {
  editingId.value = null
  const firstProviderId = providersList.value[0]?.id || ''
  const firstModels = providerModelsMap.value.get(firstProviderId) || []
  form.value = {
    client_model: '',
    strategy: 'scheduled',
    default: { backend_model: firstModels[0] || '', provider_id: firstProviderId },
    windows: [],
    targets: [],
  }
  dialogOpen.value = true
}

function openEdit(g: MappingGroup & { parsedRule?: Rule }) {
  editingId.value = g.id
  let rule: Rule = {}
  try { rule = JSON.parse(g.rule) } catch { /* eslint-disable-line taste/no-silent-catch -- 格式异常时使用空默认值 */ }

  if (g.strategy === 'scheduled') {
    form.value = {
      ...DEFAULT_FORM,
      client_model: g.client_model,
      strategy: g.strategy,
      default: {
        backend_model: rule.default?.backend_model || '',
        provider_id: rule.default?.provider_id || providersList.value[0]?.id || '',
      },
      windows: rule.windows ? JSON.parse(JSON.stringify(rule.windows)) : [],
    }
  } else {
    const firstProviderId = providersList.value[0]?.id || ''
    const firstModels = providerModelsMap.value.get(firstProviderId) || []
    form.value = {
      ...DEFAULT_FORM,
      client_model: g.client_model,
      strategy: g.strategy,
      targets: Array.isArray(rule.targets)
        ? rule.targets.map((t: { backend_model: string; provider_id: string }) => ({
            backend_model: t.backend_model || '',
            provider_id: t.provider_id || firstProviderId,
          }))
        : [{ backend_model: firstModels[0] || '', provider_id: firstProviderId }],
    }
  }
  dialogOpen.value = true
}

function addWindow() {
  const firstProviderId = providersList.value[0]?.id || ''
  const firstModels = providerModelsMap.value.get(firstProviderId) || []
  form.value.windows.push({
    start: '',
    end: '',
    target: {
      backend_model: firstModels[0] || '',
      provider_id: firstProviderId,
    },
  })
}

function removeWindow(idx: number) {
  form.value.windows.splice(idx, 1)
}

function addTarget() {
  const firstProviderId = providersList.value[0]?.id || ''
  const firstModels = providerModelsMap.value.get(firstProviderId) || []
  form.value.targets.push({ backend_model: firstModels[0] || '', provider_id: firstProviderId })
}

function removeTarget(idx: number) {
  form.value.targets.splice(idx, 1)
}

function moveTargetUp(idx: number) {
  if (idx <= 0) return
  const targets = form.value.targets
  ;[targets[idx - 1], targets[idx]] = [targets[idx], targets[idx - 1]]
}

function moveTargetDown(idx: number) {
  const targets = form.value.targets
  if (idx >= targets.length - 1) return
  ;[targets[idx], targets[idx + 1]] = [targets[idx + 1], targets[idx]]
}

async function handleSave() {
  try {
    let ruleJson: string;
    if (form.value.strategy === 'scheduled') {
      ruleJson = JSON.stringify({
        default: form.value.default,
        windows: form.value.windows,
      });
    } else {
      ruleJson = JSON.stringify({
        targets: form.value.targets,
      });
    }
    const payload = {
      client_model: form.value.client_model,
      strategy: form.value.strategy,
      rule: ruleJson,
    };
    if (editingId.value) {
      await api.updateMappingGroup(editingId.value, payload)
    } else {
      await api.createMappingGroup(payload)
    }
    dialogOpen.value = false
    await loadData()
  } catch (e) {
    console.error('Failed to save mapping group:', e)
    toast.error('保存分组失败')
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteMappingGroup(target.id)
    await loadData()
  } catch (e) {
    console.error('Failed to delete mapping group:', e)
    toast.error('删除分组失败')
  }
}

onMounted(loadData)
</script>
