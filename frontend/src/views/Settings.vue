<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api, type DbSizeInfoResponse, type ConfigExportResponse } from '@/api/client'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
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

const dbSizeInfo = ref<DbSizeInfoResponse | null>(null)
const retentionDays = ref(3)
const dbMaxSizeMb = ref(1024)
const logTableMaxSizeMb = ref(800)
const loading = ref(false)
const importing = ref(false)
const importResult = ref<Record<string, number> | null>(null)
const showImportDialog = ref(false)
const pendingImportData = ref<ConfigExportResponse | null>(null)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
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

async function saveRetention() {
  try {
    const result = await api.setLogRetention(retentionDays.value)
    retentionDays.value = result.days
    toast.success('日志保留天数已更新')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    toast.error(e.response?.data?.error?.message || '更新失败')
  }
}

async function saveThresholds() {
  try {
    const result = await api.setDbSizeThresholds({
      dbMaxSizeMb: dbMaxSizeMb.value,
      logTableMaxSizeMb: logTableMaxSizeMb.value,
    })
    dbMaxSizeMb.value = result.dbMaxSizeMb
    logTableMaxSizeMb.value = result.logTableMaxSizeMb
    toast.success('存储阈值已更新')
    await loadSettings()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    toast.error(e.response?.data?.error?.message || '更新失败')
  }
}

async function handleExport() {
  try {
    const data = await api.exportConfig()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `router-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('配置已导出')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    toast.error(e.response?.data?.error?.message || '导出失败')
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    toast.error(e.response?.data?.error?.message || '导入失败')
  } finally {
    importing.value = false
    pendingImportData.value = null
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">系统设置</h1>

    <!-- Log Retention -->
    <Card>
      <CardHeader>
        <CardTitle>日志保留策略</CardTitle>
        <CardDescription>超过保留天数的日志将被自动清理</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-end gap-4">
          <div class="space-y-2">
            <Label for="retention-days">保留天数</Label>
            <Input
              id="retention-days"
              v-model.number="retentionDays"
              type="number"
              :min="0"
              :max="90"
              class="w-32"
            />
          </div>
          <Button :disabled="loading" @click="saveRetention">保存</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Storage Management -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <HardDrive class="h-5 w-5" />
          存储管理
        </CardTitle>
        <CardDescription>监控数据库大小并配置自动清理阈值</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <template v-if="dbSizeInfo">
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>数据库总大小</span>
              <span class="text-muted-foreground">
                {{ formatBytes(dbSizeInfo.totalBytes) }} / {{ dbMaxSizeMb }} MB
              </span>
            </div>
            <Progress
              :model-value="Math.min(100, (dbSizeInfo.totalBytes / (dbMaxSizeMb * 1048576)) * 100)"
            />
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>请求日志大小 ({{ dbSizeInfo.logCount }} 条)</span>
              <span class="text-muted-foreground">
                {{ formatBytes(dbSizeInfo.logTableBytes) }} / {{ logTableMaxSizeMb }} MB
              </span>
            </div>
            <Progress
              :model-value="Math.min(100, (dbSizeInfo.logTableBytes / (logTableMaxSizeMb * 1048576)) * 100)"
            />
          </div>

          <p v-if="dbSizeInfo.lastChecked" class="text-xs text-muted-foreground">
            上次检查：{{ dbSizeInfo.lastChecked }}
          </p>
        </template>

        <div class="grid grid-cols-2 gap-4 pt-4 border-t">
          <div class="space-y-2">
            <Label for="db-max-size">数据库大小上限 (MB)</Label>
            <Input id="db-max-size" v-model.number="dbMaxSizeMb" type="number" :min="1" />
          </div>
          <div class="space-y-2">
            <Label for="log-max-size">日志表大小上限 (MB)</Label>
            <Input id="log-max-size" v-model.number="logTableMaxSizeMb" type="number" :min="1" />
          </div>
        </div>
        <Button :disabled="loading" @click="saveThresholds">保存阈值</Button>
      </CardContent>
    </Card>

    <!-- Config Import/Export -->
    <Card>
      <CardHeader>
        <CardTitle>配置导入导出</CardTitle>
        <CardDescription>导出当前配置或从文件恢复</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex gap-3">
          <Button variant="outline" :disabled="loading" @click="handleExport">
            <Download class="mr-2 h-4 w-4" />
            导出配置
          </Button>

          <label>
            <Button variant="outline" as="span" :disabled="loading">
              <Upload class="mr-2 h-4 w-4" />
              导入配置
            </Button>
            <input type="file" accept=".json" class="hidden" @change="handleFileSelect" />
          </label>
        </div>

        <div v-if="importResult" class="text-sm space-y-1 p-3 bg-muted rounded-md">
          <p class="font-medium">导入完成：</p>
          <p v-for="(count, table) in importResult" :key="table">
            {{ table }}: {{ count }} 条
          </p>
        </div>
      </CardContent>
    </Card>

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
