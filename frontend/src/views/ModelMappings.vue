<template>
  <div class="p-6">
    <Card>
      <CardContent class="pt-4">
        <!-- Add mapping row -->
        <div class="flex items-end gap-2 mb-4">
          <div class="flex-1 space-y-1">
            <Label class="text-xs text-muted-foreground">客户端模型</Label>
            <Input v-model="newFrom" placeholder="例如: sonnet, gpt-5.1" class="font-mono text-xs" @keydown.enter.prevent="addNewMapping" />
          </div>
          <div class="flex-1 space-y-1">
            <Label class="text-xs text-muted-foreground">目标模型</Label>
            <Input v-model="newTo" placeholder="例如: deepseek-chat" class="font-mono text-xs" @keydown.enter.prevent="addNewMapping" />
          </div>
          <Button size="sm" variant="outline" class="shrink-0" :disabled="!canAdd" @click="addNewMapping">添加</Button>
        </div>

        <!-- Mapping list -->
        <MappingEditor
          :entries="entries"
          :provider-groups="providerGroups"
          :show-delete="true"
          :show-add-form="false"
          @update:targets="updateTargets"
          @toggle-active="toggleActive"
          @remove="removeMapping"
        />
      </CardContent>
    </Card>

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
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import MappingEditor from '@/components/shared/MappingEditor.vue'
import type { MappingEntry, MappingTarget } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import type { MappingGroup, Provider, Rule } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'

// --- State ---
const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const newFrom = ref('')
const newTo = ref('')
const deleteTarget = ref<MappingEntry | null>(null)

// --- Computed ---
const canAdd = computed(() => newFrom.value.trim().length > 0 && newTo.value.trim().length > 0)

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

// --- Data loading ---
async function loadData() {
  const results = await Promise.allSettled([
    api.getMappingGroups(),
    api.getProviders(),
  ])
  if (results[0].status === 'fulfilled') groups.value = results[0].value
  if (results[1].status === 'fulfilled') providersList.value = results[1].value as Provider[]
}

// --- Actions ---
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

async function addNewMapping() {
  const from = newFrom.value.trim()
  const to = newTo.value.trim()
  if (!from || !to) return

  const firstProvider = providersList.value[0]
  const ruleJson = JSON.stringify({
    targets: [{ backend_model: to, provider_id: firstProvider?.id ?? '' }],
  })
  try {
    await api.createMappingGroup({ client_model: from, rule: ruleJson })
    newFrom.value = ''
    newTo.value = ''
    await loadData()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '创建映射失败'))
  }
}

onMounted(loadData)
</script>
