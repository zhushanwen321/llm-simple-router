<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
    retentionError.value = '请输入整数'
    return false
  }
  if (val < RETENTION_MIN || val > RETENTION_MAX) {
    retentionError.value = `请输入 ${RETENTION_MIN}-${RETENTION_MAX} 之间的整数`
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
    dbMaxSizeError.value = `请输入不小于 ${SIZE_MB_MIN} 的数值`
    valid = false
  }
  if (!Number.isFinite(logTableMaxSizeMb.value) || logTableMaxSizeMb.value < SIZE_MB_MIN) {
    logTableMaxSizeError.value = `请输入不小于 ${SIZE_MB_MIN} 的数值`
    valid = false
  }
  if (valid && logTableMaxSizeMb.value > dbMaxSizeMb.value) {
    logTableMaxSizeError.value = '日志表上限不应超过数据库上限'
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
    toast.success('存储阈值已更新')
    await loadSettings()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '更新失败'))
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
    toast.success('配置已导出')
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '导出失败'))
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
        toast.error('不支持的配置文件版本')
        return
      }
      pendingImportData.value = data
      showImportDialog.value = true
    } catch {
      toast.error('无效的 JSON 文件')
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
    toast.success('配置已导入')
    await loadSettings()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '导入失败'))
  } finally {
    importing.value = false
    pendingImportData.value = null
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="p-6 space-y-6">
    <h2 class="text-lg font-semibold text-foreground">系统设置</h2>

    <!-- Log Retention -->
    <div class="bg-card rounded-lg border p-4 space-y-3">
      <h3 class="font-medium text-sm text-foreground">日志保留策略</h3>
      <p class="text-sm text-muted-foreground">超过保留天数的日志将被自动清理</p>
      <div class="flex items-end gap-4">
        <div class="space-y-1">
          <Label for="retention-days">保留天数</Label>
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
        <Button size="sm" :disabled="loading" @click="handleSaveRetention">保存</Button>
      </div>
    </div>

    <!-- Storage Management -->
    <div class="bg-card rounded-lg border p-4 space-y-4">
      <h3 class="font-medium text-sm text-foreground flex items-center gap-2">
        <HardDrive class="h-4 w-4" />
        存储管理
      </h3>
      <p class="text-sm text-muted-foreground">监控数据库大小并配置自动清理阈值</p>

      <template v-if="dbSizeInfo">
        <div class="space-y-1">
          <div class="flex justify-between text-sm">
            <span>数据库总大小</span>
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
            <span>请求日志大小 ({{ dbSizeInfo.logCount }} 条)</span>
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
            <span>日志文件大小</span>
            <span class="text-muted-foreground">
              {{ formatBytes(dbSizeInfo.logFileBytes ?? 0) }}
            </span>
          </div>
        </div>

        <p v-if="dbSizeInfo.lastChecked" class="text-xs text-muted-foreground">
          上次检查：{{ dbSizeInfo.lastChecked }}
        </p>
      </template>

      <div class="grid grid-cols-2 gap-4 pt-3 border-t">
        <div class="space-y-1">
          <Label for="db-max-size">数据库大小上限 (MB)</Label>
          <Input id="db-max-size" v-model.number="dbMaxSizeMb" type="number" :min="SIZE_MB_MIN" @input="dbMaxSizeError = ''" />
          <p v-if="dbMaxSizeError" class="text-sm text-destructive mt-1">{{ dbMaxSizeError }}</p>
        </div>
        <div class="space-y-1">
          <Label for="log-max-size">日志表大小上限 (MB)</Label>
          <Input id="log-max-size" v-model.number="logTableMaxSizeMb" type="number" :min="SIZE_MB_MIN" @input="logTableMaxSizeError = ''" />
          <p v-if="logTableMaxSizeError" class="text-sm text-destructive mt-1">{{ logTableMaxSizeError }}</p>
        </div>
      </div>
      <Button size="sm" :disabled="loading" @click="saveThresholds">保存阈值</Button>
    </div>

    <!-- Config Import/Export -->
    <div class="bg-card rounded-lg border p-4 space-y-3">
      <h3 class="font-medium text-sm text-foreground">配置导入导出</h3>
      <p class="text-sm text-muted-foreground">导出当前配置或从文件恢复</p>

      <div class="flex gap-3">
        <Button variant="outline" size="sm" :disabled="loading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          导出配置
        </Button>

        <Button variant="outline" size="sm" :disabled="loading" @click="fileInput?.click()">
          <Upload class="mr-2 h-4 w-4" />
          导入配置
        </Button>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileSelect" />
      </div>

      <div v-if="importResult" class="text-sm space-y-1 p-3 bg-muted rounded-md">
        <p class="font-medium">导入完成：</p>
        <p v-for="(count, table) in importResult" :key="table">
          {{ table }}: {{ count }} 条
        </p>
      </div>
    </div>

    <!-- Import confirmation dialog -->
    <AlertDialog v-model:open="showImportDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认导入配置</AlertDialogTitle>
          <AlertDialogDescription>
            导入将覆盖当前的供应商、映射、密钥等配置。安全设置（密码、JWT）将保留不变。
            此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="importing">取消</AlertDialogCancel>
          <AlertDialogAction :disabled="importing" @click="confirmImport">
            {{ importing ? '导入中...' : '确认导入' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
