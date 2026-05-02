<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">{{ t('routerKeys.title') }}</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        {{ t('routerKeys.createKey') }}
      </Button>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">{{ t('routerKeys.tableHeaders.name') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('routerKeys.tableHeaders.key') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('routerKeys.tableHeaders.whitelist') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('routerKeys.tableHeaders.status') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('routerKeys.tableHeaders.createdAt') }}</TableHead>
            <TableHead class="text-right text-muted-foreground">{{ t('routerKeys.tableHeaders.actions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="k in keys" :key="k.id" :class="{ 'opacity-60': !k.is_active }">
            <TableCell class="font-medium">{{ k.name }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="font-mono text-xs text-muted-foreground">{{ maskKey(k.key) }}</span>
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="k.key && tableCopy(k.key)">
                  <svg v-if="!tableCopied" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <svg v-else class="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <template v-if="k.allowed_models && k.allowed_models.length > 0">
                <div class="flex flex-wrap gap-1">
                  <Badge v-for="m in k.allowed_models" :key="m" variant="outline" class="text-xs">{{ m }}</Badge>
                </div>
              </template>
              <Badge v-else variant="secondary">{{ t('common.allModels') }}</Badge>
            </TableCell>
            <TableCell>
              <Badge :variant="k.is_active ? 'default' : 'secondary'">{{ k.is_active ? t('common.enabled') : t('common.disabled') }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground text-sm">{{ formatDate(k.created_at) }}</TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(k)" class="text-muted-foreground hover:text-primary mr-2">{{ t('common.edit') }}</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(k)" class="text-muted-foreground hover:text-destructive">{{ t('common.delete') }}</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="keys.length === 0">
            <TableCell colspan="6" class="text-center text-muted-foreground py-8">{{ t('routerKeys.noKeys') }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ editingId ? t('routerKeys.editKey') : t('routerKeys.createKey') }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('routerKeys.tableHeaders.name') }}</Label>
            <Input v-model="form.name" type="text" required :placeholder="t('routerKeys.placeholder.name')" @input="delete errors.name" />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">{{ errors.name }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('routerKeys.whitelistLabel') }}</Label>
            <div class="text-xs text-muted-foreground mb-2">{{ t('routerKeys.whitelistHint') }}</div>
            <div class="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2 bg-muted">
              <Label
                v-for="model in availableModels"
                :key="model"
                class="flex items-center gap-2 cursor-pointer text-sm font-normal"
              >
                <Checkbox
                  :model-value="form.allowed_models.includes(model)"
                  @update:model-value="(val: boolean | 'indeterminate') => { if (val && val !== 'indeterminate' && !form.allowed_models.includes(model)) form.allowed_models.push(model); else if (!val) { const idx = form.allowed_models.indexOf(model); if (idx >= 0) form.allowed_models.splice(idx, 1) } }"
                />
                <span class="font-mono text-xs">{{ model }}</span>
              </Label>
              <div v-if="availableModels.length === 0" class="text-muted-foreground text-sm text-center py-2">
                {{ t('routerKeys.noModels') }}
              </div>
            </div>
            <div v-if="form.allowed_models.length > 0" class="flex flex-wrap gap-1 mt-2">
              <Badge v-for="m in form.allowed_models" :key="m" variant="outline" class="text-xs">
                {{ m }}
                <Button type="button" variant="ghost" size="sm" class="ml-1 h-4 w-4 p-0 text-muted-foreground hover:text-destructive" @click="removeModel(m)">&times;</Button>
              </Badge>
            </div>
          </div>
          <div v-if="editingId" class="flex items-center gap-2">
            <Checkbox v-model="form.is_active" id="key-active" />
            <Label for="key-active" class="text-sm text-foreground">{{ t('common.enable') }}</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="dialogOpen = false">{{ t('common.cancel') }}</Button>
            <Button type="submit">{{ t('common.save') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm AlertDialog -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('routerKeys.confirmDeleteTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('routerKeys.confirmDeleteDesc', { name: deleteTarget?.name }) }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">{{ t('common.delete') }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import { formatTime } from '@/utils/format'
import { useClipboard } from '@/composables/useClipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'

interface RouterKey {
  id: string
  name: string
  key: string | null
  key_prefix: string
  allowed_models: string[] | null
  is_active: number
  created_at: string
}

const { t } = useI18n()

const DEFAULT_FORM = { name: '', allowed_models: [] as string[], is_active: true }

const keys = ref<RouterKey[]>([])
const availableModels = ref<string[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<RouterKey | null>(null)
const form = ref({ ...DEFAULT_FORM, allowed_models: [] as string[] })
const errors = ref<Record<string, string>>({})
const { copied: tableCopied, copy: tableCopy } = useClipboard()

function maskKey(key: string | null): string {
  if (!key) return ''
  return key.slice(0, 7) + '*'.repeat(7) // eslint-disable-line no-magic-numbers
}

function formatDate(dateStr: string): string {
  return formatTime(dateStr)
}

function removeModel(model: string) {
  const idx = form.value.allowed_models.indexOf(model)
  if (idx >= 0) form.value.allowed_models.splice(idx, 1)
}

async function loadData() {
  try {
    const [keysRes, modelsRes] = await Promise.allSettled([
      api.getRouterKeys(),
      api.getAvailableModels(),
    ])
    if (keysRes.status === 'fulfilled') keys.value = keysRes.value
    if (modelsRes.status === 'fulfilled') availableModels.value = modelsRes.value
  } catch (e: unknown) {
    console.error('Failed to load data:', e)
    toast.error(getApiMessage(e, t('routerKeys.loadFailed')))
  }
}

function openCreate() {
  editingId.value = null
  form.value = { ...DEFAULT_FORM, allowed_models: [] }
  errors.value = {}
  dialogOpen.value = true
}

function openEdit(k: RouterKey) {
  editingId.value = k.id
  form.value = {
    name: k.name,
    allowed_models: k.allowed_models ? [...k.allowed_models] : [],
    is_active: !!k.is_active,
  }
  errors.value = {}
  dialogOpen.value = true
}

function buildUpdatePayload(): { name: string; allowed_models: string[] | null; is_active: number } {
  return {
    name: form.value.name,
    allowed_models: form.value.allowed_models.length > 0 ? form.value.allowed_models : null,
    is_active: form.value.is_active ? 1 : 0,
  }
}

function buildCreatePayload(): { name: string; allowed_models: string[] | null } {
  return {
    name: form.value.name,
    allowed_models: form.value.allowed_models.length > 0 ? form.value.allowed_models : null,
  }
}

async function handleSave() {
  const errs: Record<string, string> = {}
  const name = form.value.name.trim()
  if (!name) errs.name = t('routerKeys.nameRequired')
  errors.value = errs
  if (Object.keys(errs).length > 0) return

  try {
    if (editingId.value) {
      await api.updateRouterKey(editingId.value, buildUpdatePayload())
    } else {
      await api.createRouterKey(buildCreatePayload())
    }
    dialogOpen.value = false
    await loadData()
  } catch (e: unknown) {
    console.error('Failed to save router key:', e)
    toast.error(getApiMessage(e, t('routerKeys.saveFailed')))
  }
}

function confirmDelete(k: RouterKey) {
  deleteTarget.value = k
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteRouterKey(target.id)
    await loadData()
  } catch (e: unknown) {
    console.error('Failed to delete router key:', e)
    toast.error(getApiMessage(e, t('routerKeys.deleteFailed')))
  }
}

onMounted(loadData)
</script>
