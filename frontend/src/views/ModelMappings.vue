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

    <div class="grid grid-cols-3 gap-4">
      <Card v-for="g in groupsWithParsedRule" :key="g.id" :class="{ 'opacity-60': !g.is_active }">
        <CardHeader class="flex flex-row items-center justify-between gap-2 pb-2">
          <div class="flex items-center gap-2 min-w-0">
            <CardTitle class="font-mono text-sm truncate">{{ g.client_model }}</CardTitle>
            <Badge variant="secondary">{{ g.strategy }}</Badge>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" class="gap-1" @click="confirmToggle(g)">
              <span
                class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
                :class="g.is_active ? 'bg-primary' : 'bg-input'"
              >
                <span
                  class="inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform"
                  :class="g.is_active ? 'translate-x-3.5' : 'translate-x-0.5'"
                />
              </span>
            </Button>
            <Button variant="ghost" size="sm" @click="openEdit(g)">编辑</Button>
            <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="deleteTarget = g">删除</Button>
          </div>
        </CardHeader>
        <CardContent>
          <!-- scheduled: 默认模型 + 时间窗口 -->
          <div v-if="g.strategy === 'scheduled'" class="space-y-1.5 text-sm">
            <div class="flex items-center gap-1.5">
              <span class="font-mono">{{ g.parsedRule.default?.backend_model || '-' }}</span>
              <span class="text-muted-foreground">/</span>
              <span class="text-muted-foreground">{{ providerNameMap.get(g.parsedRule.default?.provider_id || '') || '-' }}</span>
              <template v-if="g.parsedRule.default?.overflow_model">
                <span class="text-muted-foreground">→</span>
                <span class="font-mono text-primary">{{ g.parsedRule.default.overflow_model }}</span>
              </template>
            </div>
            <div v-if="g.parsedRule.windows?.length" class="space-y-1">
              <div
                v-for="(w, idx) in g.parsedRule.windows.slice(0, 3)"
                :key="idx"
                class="flex items-center gap-1.5 text-xs"
              >
                <span class="font-mono bg-muted px-1.5 py-0.5 rounded">{{ w.start }}-{{ w.end }}</span>
                <span class="font-mono">{{ w.target.backend_model }}</span>
                <span class="text-muted-foreground">/</span>
                <span class="text-muted-foreground">{{ providerNameMap.get(w.target.provider_id) || w.target.provider_id }}</span>
                <template v-if="w.target.overflow_model">
                  <span class="text-muted-foreground">→</span>
                  <span class="font-mono text-primary">{{ w.target.overflow_model }}</span>
                </template>
              </div>
              <div v-if="g.parsedRule.windows.length > 3" class="text-xs text-muted-foreground">
                +{{ g.parsedRule.windows.length - 3 }} 个窗口...
              </div>
            </div>
            <div v-else class="text-xs text-muted-foreground">无时间窗口</div>
          </div>
          <!-- round-robin / random / failover: 目标列表 -->
          <div v-else class="space-y-1.5 text-sm">
            <div v-for="(t, idx) in (g.parsedRule.targets || [])" :key="idx" class="flex items-center gap-1.5">
              <span v-if="g.strategy === 'failover'" class="text-muted-foreground text-xs w-4">{{ idx + 1 }}.</span>
              <span class="font-mono">{{ t.backend_model }}</span>
              <span class="text-muted-foreground">/</span>
              <span class="text-muted-foreground">{{ providerNameMap.get(t.provider_id) || t.provider_id }}</span>
              <template v-if="t.overflow_model">
                <span class="text-muted-foreground">→</span>
                <span class="font-mono text-primary">{{ t.overflow_model }}</span>
              </template>
            </div>
            <div v-if="!(g.parsedRule.targets || []).length" class="text-xs text-muted-foreground">无目标</div>
          </div>
        </CardContent>
      </Card>

      <div v-if="groups.length === 0" class="col-span-3 text-center text-muted-foreground py-12 bg-card rounded-xl border">
        暂无映射分组
      </div>
    </div>

    <MappingGroupFormDialog
      v-model:open="dialogOpen"
      :editing-id="editingId"
      :form="form"
      :providers="providersList"
      :provider-groups="providerGroups"
      :context-window-map="contextWindowMap"
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

    <AlertDialog :open="!!toggleTarget" @update:open="(val: boolean) => { if (!val) toggleTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认{{ toggleTarget?.is_active ? '禁用' : '启用' }}</AlertDialogTitle>
          <AlertDialogDescription>确定要{{ toggleTarget?.is_active ? '禁用' : '启用' }}映射「{{ toggleTarget?.client_model }}」吗？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="handleToggle">确认</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import MappingGroupFormDialog from '@/components/mappings/MappingGroupFormDialog.vue'
import MappingGroupDeleteDialog from '@/components/mappings/MappingGroupDeleteDialog.vue'
import type { MappingGroup, Provider, MappingTarget, RuleWindow, Rule } from '@/types/mapping'
import type { ProviderGroup } from '@/components/mappings/cascading-types'

const DEFAULT_CONTEXT_WINDOW = 200_000

const DEFAULT_FORM: {
  client_model: string
  strategy: string
  default: MappingTarget
  windows: RuleWindow[]
  targets: MappingTarget[]
} = {
  client_model: '',
  strategy: 'scheduled',
  default: { backend_model: '', provider_id: '' },
  windows: [],
  targets: [],
}

const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<MappingGroup | null>(null)
const toggleTarget = ref<MappingGroup | null>(null)
const form = ref({ ...DEFAULT_FORM })

const providerNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const p of providersList.value) map.set(p.id, p.name)
  return map
})

const providerGroups = computed<ProviderGroup[]>(() =>
  providersList.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
    })),
  }))
)

const contextWindowMap = computed(() => {
  const map = new Map<string, number>()
  for (const p of providersList.value) {
    for (const m of p.models ?? []) {
      if (m.context_window != null) {
        map.set(`${p.id}:${m.name}`, m.context_window)
      }
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
    groups.value = results[0].value
  } else {
    console.error('Failed to load groups:', results[0].reason)
  }
  if (results[1].status === 'fulfilled') {
    providersList.value = results[1].value as Provider[]
  } else {
    console.error('Failed to load providers:', results[1].reason)
    toast.error((results[1].reason as { apiMessage?: string })?.apiMessage || '加载供应商失败')
  }
}

function getFirstModel(providerId: string): string {
  const p = providersList.value.find(x => x.id === providerId)
  return p?.models?.[0]?.name || ''
}

function openCreate() {
  editingId.value = null
  const firstProviderId = providersList.value[0]?.id || ''
  form.value = {
    client_model: '',
    strategy: 'scheduled',
    default: { backend_model: getFirstModel(firstProviderId), provider_id: firstProviderId },
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
        overflow_provider_id: rule.default?.overflow_provider_id,
        overflow_model: rule.default?.overflow_model,
      },
      windows: rule.windows ? JSON.parse(JSON.stringify(rule.windows)) : [],
    }
  } else {
    const firstProviderId = providersList.value[0]?.id || ''
    form.value = {
      ...DEFAULT_FORM,
      client_model: g.client_model,
      strategy: g.strategy,
      targets: Array.isArray(rule.targets)
        ? rule.targets.map((t: MappingTarget) => ({
          backend_model: t.backend_model || '',
          provider_id: t.provider_id || firstProviderId,
          overflow_provider_id: t.overflow_provider_id,
          overflow_model: t.overflow_model,
        }))
        : [{ backend_model: getFirstModel(firstProviderId), provider_id: firstProviderId }],
    }
  }
  dialogOpen.value = true
}

function addWindow() {
  const firstProviderId = providersList.value[0]?.id || ''
  form.value.windows.push({
    start: '',
    end: '',
    target: {
      backend_model: getFirstModel(firstProviderId),
      provider_id: firstProviderId,
    },
  })
}

function removeWindow(idx: number) {
  form.value.windows.splice(idx, 1)
}

function addTarget() {
  const firstProviderId = providersList.value[0]?.id || ''
  form.value.targets.push({ backend_model: getFirstModel(firstProviderId), provider_id: firstProviderId })
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
  } catch (e: unknown) {
    console.error('Failed to save mapping group:', e)
    toast.error((e as { apiMessage?: string }).apiMessage || '保存分组失败')
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteMappingGroup(target.id)
    await loadData()
  } catch (e: unknown) {
    console.error('Failed to delete mapping group:', e)
    toast.error((e as { apiMessage?: string }).apiMessage || '删除分组失败')
  }
}

onMounted(loadData)
</script>
