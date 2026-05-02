<template>
  <div class="p-6 space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-foreground">模型映射</h2>
        <div class="flex gap-2 mt-1">
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{{ groups.length }} 条映射</span>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{{ activeCount }} 启用</span>
        </div>
      </div>
      <Button v-if="!editing" size="sm" variant="outline" @click="editing = true">
        <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        编辑
      </Button>
      <Button v-else size="sm" @click="editing = false">
        <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        保存
      </Button>
    </div>

    <!-- Mapping List -->
    <MappingList
      :entries="entries"
      :provider-groups="providerGroups"
      :show-delete="true"
      :show-add-form="true"
      :readonly="!editing"
      @update:targets="updateTargets"
      @toggle-active="toggleActive"
      @remove="removeMapping"
      @add="addNewMapping"
    />

    <!-- Delete Confirm -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val: boolean) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除映射「{{ deleteTarget?.clientModel }}」吗？此操作不可撤销。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">删除</Button>
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
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import MappingList from '@/components/shared/MappingList.vue'
import type { MappingEntry, MappingTarget } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import type { MappingGroup, Provider, Rule } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'

const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const deleteTarget = ref<MappingEntry | null>(null)
const editing = ref(false)

const activeCount = computed(() => groups.value.filter(g => g.is_active).length)

const providerGroups = computed<ProviderGroup[]>(() =>
  providersList.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
    })),
  }))
)

const entries = computed<MappingEntry[]>(() =>
  groups.value.map((g) => {
    let rule: Rule = {}
    try {
      const parsed = JSON.parse(g.rule)
      rule = parsed.default && !parsed.targets ? { targets: [parsed.default] } : parsed
    } catch { /* ignore */ }
    const targets: MappingTarget[] = (rule.targets ?? []).map((t: MappingTarget) => ({
      backend_model: t.backend_model || '',
      provider_id: t.provider_id || '',
      overflow_provider_id: t.overflow_provider_id,
      overflow_model: t.overflow_model,
    }))
    return {
      clientModel: g.client_model,
      targets: targets.length > 0 ? targets : [{ backend_model: '', provider_id: providersList.value[0]?.id ?? '' }],
      existing: true,
      existingId: g.id,
      tag: 'existing' as const,
      active: !!g.is_active,
      originalActive: !!g.is_active,
    }
  })
)

async function loadData() {
  const results = await Promise.allSettled([
    api.getMappingGroups(),
    api.getProviders(),
  ])
  if (results[0].status === 'fulfilled') groups.value = results[0].value
  if (results[1].status === 'fulfilled') providersList.value = results[1].value as Provider[]
}

function updateTargets(index: number, targets: MappingTarget[]) {
  const entry = entries.value[index]
  if (!entry?.existingId) return
  const ruleJson = JSON.stringify({ targets })
  api.updateMappingGroup(entry.existingId, {
    client_model: entry.clientModel,
    rule: ruleJson,
  }).then(() => loadData()).catch((e: unknown) => {
    toast.error(getApiMessage(e, '更新映射失败'))
  })
}

async function toggleActive(index: number) {
  const entry = entries.value[index]
  if (!entry?.existingId) return
  try {
    await api.toggleMappingGroup(entry.existingId)
    await loadData()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '切换状态失败'))
  }
}

function removeMapping(clientModel: string) {
  const entry = entries.value.find(e => e.clientModel === clientModel)
  if (entry) deleteTarget.value = entry
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target?.existingId) return
  deleteTarget.value = null
  try {
    await api.deleteMappingGroup(target.existingId)
    await loadData()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '删除映射失败'))
  }
}

async function addNewMapping(clientModel: string, targetModel: string) {
  const firstProvider = providersList.value[0]
  const ruleJson = JSON.stringify({
    targets: [{ backend_model: targetModel, provider_id: firstProvider?.id ?? '' }],
  })
  try {
    await api.createMappingGroup({ client_model: clientModel, rule: ruleJson })
    await loadData()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '创建映射失败'))
  }
}

onMounted(loadData)
</script>
