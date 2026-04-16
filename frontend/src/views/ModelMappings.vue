<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">模型映射</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        添加分组
      </Button>
    </div>

    <div class="space-y-4">
      <Card v-for="g in groupsWithParsedRule" :key="g.id" class="bg-white">
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
              <Button variant="ghost" size="sm" class="text-red-600 hover:text-red-700" @click="deleteTarget = g">删除</Button>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div class="space-y-3">
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-gray-500">默认模型:</span>
                  <span class="font-mono">{{ g.parsedRule.default?.backend_model || '-' }}</span>
                  <span class="text-gray-400">/</span>
                  <span>{{ providerNameMap.get(g.parsedRule.default?.provider_id || '') || '-' }}</span>
                </div>
                <div v-if="g.parsedRule.windows?.length" class="space-y-2">
                  <div class="text-sm text-gray-500">时间窗口</div>
                  <div
                    v-for="(w, idx) in g.parsedRule.windows"
                    :key="idx"
                    class="flex items-center gap-2 text-sm"
                  >
                    <span class="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{{ w.start }} - {{ w.end }}</span>
                    <span class="font-mono">{{ w.backend_model }}</span>
                    <span class="text-gray-400">/</span>
                    <span>{{ providerNameMap.get(w.provider_id) || w.provider_id }}</span>
                  </div>
                </div>
                <div v-else class="text-sm text-gray-400">无时间窗口</div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <div v-if="groups.length === 0" class="text-center text-gray-400 py-12 bg-white rounded-xl border">
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
  backend_model: string
  provider_id: string
}

interface Rule {
  default?: { backend_model: string; provider_id: string }
  windows?: RuleWindow[]
}

const DEFAULT_FORM = {
  client_model: '',
  strategy: 'scheduled',
  default: { backend_model: '', provider_id: '' },
  windows: [] as RuleWindow[],
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

// 从已有分组中提取每个 provider 对应的去重模型列表
const providerModelsMap = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const g of groups.value) {
    try {
      const rule = JSON.parse(g.rule) as Rule
      const entries = [
        rule.default,
        ...(rule.windows || []),
      ].filter(Boolean) as Array<{ provider_id?: string; backend_model?: string }>
      for (const e of entries) {
        if (e.provider_id && e.backend_model) {
          const set = map.get(e.provider_id) || new Set<string>()
          set.add(e.backend_model)
          map.set(e.provider_id, set)
        }
      }
    } catch { /* skip invalid rule */ }
  }
  return new Map([...map.entries()].map(([k, v]) => [k, [...v]]))
})

// 预解析 rule，避免模板中重复调用 parsedRule()
const groupsWithParsedRule = computed(() =>
  groups.value.map((g) => {
    let parsedRule: Rule = {}
    try {
      parsedRule = JSON.parse(g.rule) as Rule
    } catch { /* keep default empty */ }
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
  form.value = {
    ...DEFAULT_FORM,
    default: { backend_model: '', provider_id: providersList.value[0]?.id || '' },
  }
  dialogOpen.value = true
}

function openEdit(g: MappingGroup & { parsedRule?: Rule }) {
  editingId.value = g.id
  let rule: Rule = {}
  try { rule = JSON.parse(g.rule) as Rule } catch { /* empty */ }
  form.value = {
    client_model: g.client_model,
    strategy: g.strategy,
    default: {
      backend_model: rule.default?.backend_model || '',
      provider_id: rule.default?.provider_id || providersList.value[0]?.id || '',
    },
    windows: rule.windows ? JSON.parse(JSON.stringify(rule.windows)) : [],
  }
  dialogOpen.value = true
}

function addWindow() {
  form.value.windows.push({
    start: '',
    end: '',
    backend_model: '',
    provider_id: providersList.value[0]?.id || '',
  })
}

function removeWindow(idx: number) {
  form.value.windows.splice(idx, 1)
}

async function handleSave() {
  try {
    const payload = {
      client_model: form.value.client_model,
      strategy: form.value.strategy,
      rule: JSON.stringify({
        default: form.value.default,
        windows: form.value.windows,
      }),
    }
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
