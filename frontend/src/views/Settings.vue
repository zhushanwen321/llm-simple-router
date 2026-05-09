<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage, type DbSizeInfoResponse, type ConfigExportResponse } from '@/api/client'
import { useLogRetention } from '@/composables/useLogRetention'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Download, Upload, HardDrive } from 'lucide-vue-next'

const { t } = useI18n()

const BYTES_PER_MB = 1_048_576
const KB_BASE = 1024
const PERCENT_MAX = 100
const JSON_INDENT = 2
const DATE_SLICE_END = 10

const RETENTION_MIN = 0
const RETENTION_MAX = 90
const SIZE_MB_MIN = 1
const DEFAULT_DB_MAX_SIZE_MB = 1024
const DEFAULT_LOG_TABLE_MAX_SIZE_MB = 800

const { retentionDays, saveRetention } = useLogRetention()

const dbSizeInfo = ref<DbSizeInfoResponse | null>(null)
const dbMaxSizeMb = ref(DEFAULT_DB_MAX_SIZE_MB)
const logTableMaxSizeMb = ref(DEFAULT_LOG_TABLE_MAX_SIZE_MB)
const loading = ref(false)
const importing = ref(false)
const importResult = ref<Record<string, number> | null>(null)
const showImportDialog = ref(false)
const pendingImportData = ref<ConfigExportResponse | null>(null)
const fileInput = ref<HTMLInputElement>()

const retentionError = ref('')
const dbMaxSizeError = ref('')
const logTableMaxSizeError = ref('')

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(KB_BASE)), units.length - 1)
  return `${(bytes / Math.pow(KB_BASE, i)).toFixed(1)} ${units[i]}`
}

async function loadSettings() {
  loading.value = true
  try {
    const [sizeInfo, retention] = await Promise.allSettled([
      api.getDbSizeInfo(),
      api.getLogRetention(),
    ])
    if (sizeInfo.status === 'fulfilled') {
      dbSizeInfo.value = sizeInfo.value
      dbMaxSizeMb.value = sizeInfo.value.thresholds.dbMaxSizeMb
      logTableMaxSizeMb.value = sizeInfo.value.thresholds.logTableMaxSizeMb
    }
    if (retention.status === 'fulfilled') {
      retentionDays.value = retention.value.days
    }
  } finally {
    loading.value = false
  }
}

function validateRetention(): boolean {
  retentionError.value = ''
  const val = retentionDays.value
  if (!Number.isInteger(val)) {
    retentionError.value = t('settings.retention.integerRequired')
    return false
  }
  if (val < RETENTION_MIN || val > RETENTION_MAX) {
    retentionError.value = t('settings.retention.rangeError', { min: RETENTION_MIN, max: RETENTION_MAX })
    return false
  }
  return true
}

async function handleSaveRetention() {
  if (!validateRetention()) return
  await saveRetention()
}

function validateThresholds(): boolean {
  dbMaxSizeError.value = ''
  logTableMaxSizeError.value = ''
  let valid = true
  if (!Number.isFinite(dbMaxSizeMb.value) || dbMaxSizeMb.value < SIZE_MB_MIN) {
    dbMaxSizeError.value = t('settings.storage.minValueError', { min: SIZE_MB_MIN })
    valid = false
  }
  if (!Number.isFinite(logTableMaxSizeMb.value) || logTableMaxSizeMb.value < SIZE_MB_MIN) {
    logTableMaxSizeError.value = t('settings.storage.minValueError', { min: SIZE_MB_MIN })
    valid = false
  }
  if (valid && logTableMaxSizeMb.value > dbMaxSizeMb.value) {
    logTableMaxSizeError.value = t('settings.storage.logExceedsDbError')
    valid = false
  }
  return valid
}

async function saveThresholds() {
  if (!validateThresholds()) return
  try {
    const result = await api.setDbSizeThresholds({
      dbMaxSizeMb: dbMaxSizeMb.value,
      logTableMaxSizeMb: logTableMaxSizeMb.value,
    })
    dbMaxSizeMb.value = result.dbMaxSizeMb
    logTableMaxSizeMb.value = result.logTableMaxSizeMb
    toast.success(t('settings.storage.thresholdsUpdated'))
    await loadSettings()
  } catch (e: unknown) {
    console.error('settings.updateThresholds:', e)
    toast.error(getApiMessage(e, t('settings.storage.updateFailed')))
  }
}

async function handleExport() {
  try {
    const data = await api.exportConfig()
    const blob = new Blob([JSON.stringify(data, null, JSON_INDENT)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `router-config-${new Date().toISOString().slice(0, DATE_SLICE_END)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('settings.importExport.exportSuccess'))
  } catch (e: unknown) {
    console.error('settings.export:', e)
    toast.error(getApiMessage(e, t('settings.importExport.exportFailed')))
  }
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as ConfigExportResponse
      if (!data.version || data.version !== 1) {
        toast.error(t('settings.importExport.unsupportedVersion'))
        return
      }
      pendingImportData.value = data
      showImportDialog.value = true
    } catch {
      toast.error(t('settings.importExport.invalidJson'))
    }
  }
  reader.readAsText(file)
  input.value = ''
}

async function confirmImport() {
  if (!pendingImportData.value) return
  importing.value = true
  try {
    const result = await api.importConfig(pendingImportData.value)
    importResult.value = result
    showImportDialog.value = false
    toast.success(t('settings.importExport.importSuccess'))
    await loadSettings()
  } catch (e: unknown) {
    console.error('settings.import:', e)
    toast.error(getApiMessage(e, t('settings.importExport.importFailed')))
  } finally {
    importing.value = false
    pendingImportData.value = null
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="p-6 space-y-6">
    <h2 class="text-lg font-semibold text-foreground">{{ t('settings.title') }}</h2>

    <!-- Log Retention -->
    <div class="bg-card rounded-lg border p-4 space-y-3">
      <h3 class="font-medium text-sm text-foreground">{{ t('settings.retention.title') }}</h3>
      <p class="text-sm text-muted-foreground">{{ t('settings.retention.desc') }}</p>
      <div class="flex items-end gap-4">
        <div class="space-y-1">
          <Label for="retention-days">{{ t('settings.retention.daysLabel') }}</Label>
          <Input
            id="retention-days"
            v-model.number="retentionDays"
            type="number"
            :min="RETENTION_MIN"
            :max="RETENTION_MAX"
            class="w-32"
            @input="retentionError = ''"
          />
          <p v-if="retentionError" class="text-sm text-destructive mt-1">{{ retentionError }}</p>
        </div>
        <Button size="sm" :disabled="loading" @click="handleSaveRetention">{{ t('common.save') }}</Button>
      </div>
    </div>

    <!-- Storage Management -->
    <div class="bg-card rounded-lg border p-4 space-y-4">
      <h3 class="font-medium text-sm text-foreground flex items-center gap-2">
        <HardDrive class="h-4 w-4" />
        {{ t('settings.storage.title') }}
      </h3>
      <p class="text-sm text-muted-foreground">{{ t('settings.storage.desc') }}</p>

      <template v-if="dbSizeInfo">
        <div class="space-y-1">
          <div class="flex justify-between text-sm">
            <span>{{ t('settings.storage.dbTotalSize') }}</span>
            <span class="text-muted-foreground">
              {{ formatBytes(dbSizeInfo.totalBytes) }} / {{ dbMaxSizeMb }} MB
            </span>
          </div>
          <Progress
            :model-value="Math.min(PERCENT_MAX, (dbSizeInfo.totalBytes / (dbMaxSizeMb * BYTES_PER_MB)) * PERCENT_MAX)"
          />
        </div>

        <div class="space-y-1">
          <div class="flex justify-between text-sm">
            <span>{{ t('settings.storage.logSize') }} ({{ t('common.count', { count: dbSizeInfo.logCount }) }})</span>
            <span class="text-muted-foreground">
              {{ formatBytes(dbSizeInfo.logTableBytes) }} / {{ logTableMaxSizeMb }} MB
            </span>
          </div>
          <Progress
            :model-value="Math.min(PERCENT_MAX, (dbSizeInfo.logTableBytes / (logTableMaxSizeMb * BYTES_PER_MB)) * PERCENT_MAX)"
          />
        </div>

        <div class="space-y-1">
          <div class="flex justify-between text-sm">
            <span>{{ t('settings.storage.logFileSize') }}</span>
            <span class="text-muted-foreground">
              {{ formatBytes(dbSizeInfo.logFileBytes ?? 0) }}
            </span>
          </div>
        </div>

        <p v-if="dbSizeInfo.lastChecked" class="text-xs text-muted-foreground">
          {{ t('common.lastChecked') }}：{{ dbSizeInfo.lastChecked }}
        </p>
      </template>

      <div class="grid grid-cols-2 gap-4 pt-3 border-t">
        <div class="space-y-1">
          <Label for="db-max-size">{{ t('settings.storage.dbMaxSizeLabel') }}</Label>
          <Input id="db-max-size" v-model.number="dbMaxSizeMb" type="number" :min="SIZE_MB_MIN" @input="dbMaxSizeError = ''" />
          <p v-if="dbMaxSizeError" class="text-sm text-destructive mt-1">{{ dbMaxSizeError }}</p>
        </div>
        <div class="space-y-1">
          <Label for="log-max-size">{{ t('settings.storage.logMaxSizeLabel') }}</Label>
          <Input id="log-max-size" v-model.number="logTableMaxSizeMb" type="number" :min="SIZE_MB_MIN" @input="logTableMaxSizeError = ''" />
          <p v-if="logTableMaxSizeError" class="text-sm text-destructive mt-1">{{ logTableMaxSizeError }}</p>
        </div>
      </div>
      <Button size="sm" :disabled="loading" @click="saveThresholds">{{ t('common.saveThresholds') }}</Button>
    </div>

    <!-- Config Import/Export -->
    <div class="bg-card rounded-lg border p-4 space-y-3">
      <h3 class="font-medium text-sm text-foreground">{{ t('settings.importExport.title') }}</h3>
      <p class="text-sm text-muted-foreground">{{ t('settings.importExport.desc') }}</p>

      <div class="flex gap-3">
        <Button variant="outline" size="sm" :disabled="loading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          {{ t('settings.importExport.export') }}
        </Button>

        <Button variant="outline" size="sm" :disabled="loading" @click="fileInput?.click()">
          <Upload class="mr-2 h-4 w-4" />
          {{ t('settings.importExport.import') }}
        </Button>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileSelect" />
      </div>

      <div v-if="importResult" class="text-sm space-y-1 p-3 bg-muted rounded-md">
        <p class="font-medium">{{ t('settings.importExport.importComplete') }}</p>
        <p v-for="(count, table) in importResult" :key="table">
          {{ table }}: {{ t('common.count', { count }) }}
        </p>
      </div>
    </div>

    <!-- Import confirmation dialog -->
    <AlertDialog v-model:open="showImportDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('settings.importExport.confirmImport') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.importExport.importWarning') }}
            {{ t('common.irreversible') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="importing">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="importing" @click="confirmImport">
            {{ importing ? t('settings.importExport.importing') : t('settings.importExport.confirmButton') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
