<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">请求日志</h2>
      <Button
        variant="outline"
        class="text-destructive border-destructive hover:bg-destructive/10"
        @click="showCleanup = true"
      >
        清理日志
      </Button>
    </div>

    <!-- 筛选栏 -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="flex gap-1">
        <Button
          v-for="p in PERIODS"
          :key="p.value"
          :variant="period === p.value ? 'default' : 'ghost'"
          size="sm"
          @click="period = p.value"
        >
          {{ p.label }}
        </Button>
      </div>
      <div class="flex items-center gap-1">
        <Input type="datetime-local" v-model="dateRange.start" class="w-44" />
        <span class="text-muted-foreground text-sm">-</span>
        <Input type="datetime-local" v-model="dateRange.end" class="w-44" />
        <Button v-if="dateRange.start || dateRange.end" variant="ghost" size="sm" @click="clearDateRange">清除</Button>
        <span v-if="dateRangeError" class="text-xs text-destructive whitespace-nowrap">{{ dateRangeError }}</span>
      </div>
      <Select v-model="providerFilter">
        <SelectTrigger class="w-28 truncate">
          <SelectValue placeholder="全部供应商" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部供应商</SelectItem>
          <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="modelFilter">
        <SelectTrigger class="w-32 truncate">
          <SelectValue placeholder="全部模型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部模型</SelectItem>
          <SelectItem v-for="m in filteredModelOptions" :key="m" :value="m">{{ m }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="keyFilter">
        <SelectTrigger class="w-32 truncate">
          <SelectValue placeholder="全部密钥" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部密钥</SelectItem>
          <SelectItem v-for="rk in routerKeys" :key="rk.id" :value="rk.id">{{ rk.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="w-10"></TableHead>
            <TableHead class="text-muted-foreground">ID</TableHead>
            <TableHead class="text-muted-foreground">时间</TableHead>
            <TableHead class="text-muted-foreground">类型</TableHead>
            <TableHead class="text-muted-foreground">模型</TableHead>
            <TableHead class="text-muted-foreground">实际转发</TableHead>
            <TableHead class="text-muted-foreground">状态码</TableHead>
            <TableHead class="text-muted-foreground">延迟</TableHead>
            <TableHead class="text-muted-foreground">流式</TableHead>
            <TableHead class="text-muted-foreground">重试</TableHead>
            <TableHead class="text-muted-foreground">故障转移</TableHead>
            <TableHead class="text-muted-foreground">错误</TableHead>
            <TableHead class="text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-for="log in logs" :key="log.id">
            <LogTableRow
              :log="log"
              :expanded="expandedRows.has(log.id)"
              @toggle-expand="toggleExpand"
              @open-detail="openLogDetail"
            />

            <template v-if="expandedRows.has(log.id)">
              <TableRow v-if="childLoading[log.id]">
                <TableCell :colspan="TABLE_COL_COUNT" class="text-center py-2 pl-10">
                  <Skeleton class="h-4 w-32 mx-auto" />
                </TableCell>
              </TableRow>
              <template v-else-if="childLogs[log.id]?.length">
                <LogTableRow
                  v-for="child in childLogs[log.id]"
                  :key="child.id"
                  :log="child"
                  :is-child="true"
                  @open-detail="openLogDetail"
                />
              </template>
            </template>
          </template>

          <TableRow v-if="logs.length === 0">
            <TableCell :colspan="TABLE_COL_COUNT" class="text-center text-muted-foreground py-8">暂无日志</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex items-center justify-between mt-4">
      <p class="text-sm text-muted-foreground">共 {{ total }} 条，第 {{ page }} / {{ totalPages }} 页</p>
      <div class="flex items-center gap-1">
        <Button variant="outline" size="sm" @click="goToPage(1)" :disabled="page <= 1">首页</Button>
        <Button variant="outline" size="sm" @click="goToPage(page - 1)" :disabled="page <= 1">上一页</Button>
        <template v-for="item in pageNumbers" :key="item">
          <span v-if="item === '...'" class="px-2 text-sm text-muted-foreground">...</span>
          <Button
            v-else
            :variant="item === page ? 'default' : 'outline'"
            size="sm"
            class="min-w-8"
            @click="goToPage(item)"
          >{{ item }}</Button>
        </template>
        <Button variant="outline" size="sm" @click="goToPage(page + 1)" :disabled="page >= totalPages">下一页</Button>
        <Button variant="outline" size="sm" @click="goToPage(totalPages)" :disabled="page >= totalPages">末页</Button>
      </div>
    </div>

    <!-- Unified log detail dialog -->
    <UnifiedRequestDialog
      v-model:open="logDetailOpen"
      source="history"
      :log-entry="selectedLogEntry"
    />

    <Dialog v-model:open="showCleanup">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>清理日志</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">删除指定天数之前的日志</p>
        <div class="mb-4">
          <Label class="block text-sm font-medium text-foreground mb-1">保留最近天数</Label>
          <Input v-model.number="cleanupDays" type="number" :min="1" />
        </div>
        <Separator />
        <div class="space-y-3">
          <div class="text-sm font-medium">自动清理设置</div>
          <div class="flex items-center gap-3">
            <Label class="whitespace-nowrap">保留天数</Label>
            <Input
              type="number"
              v-model.number="retentionDays"
              :min="0"
              :max="90"
              class="w-20"
            />
            <span class="text-xs text-muted-foreground">0 = 不自动清理</span>
          </div>
          <div class="flex justify-end">
            <Button size="sm" @click="saveRetention" :disabled="retentionSaving">
              保存设置
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCleanup = false">取消</Button>
          <Button variant="destructive" @click="handleCleanup">确认清理</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Cleanup result dialog -->
    <AlertDialog v-model:open="showCleanupResult">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>清理完成</AlertDialogTitle>
          <AlertDialogDescription>已删除 {{ cleanupResult }} 条日志。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction @click="showCleanupResult = false">确定</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import UnifiedRequestDialog from '@/components/request-detail/UnifiedRequestDialog.vue'
import LogTableRow from '@/components/logs/LogTableRow.vue'
import { useLogFilters } from '@/composables/useLogFilters'
import { useLogs } from '@/composables/useLogs'
import { useLogRetention } from '@/composables/useLogRetention'

const {
  PERIODS, period, dateRange, dateRangeError,
  providerFilter, modelFilter, keyFilter,
  providers, routerKeys, filteredModelOptions, clearDateRange,
  buildFilterParams,
} = useLogFilters()

const TABLE_COL_COUNT = 13
const DEBOUNCE_MS = 300
const MAX_PAGE_BUTTONS = 7
const PAGE_NEIGHBORS = 2
const FIRST_PAGE = 1

const {
  logs, total, page, totalPages,
  cleanupDays, showCleanup, cleanupResult, showCleanupResult,
  expandedRows, childLogs, childLoading,
  logDetailOpen, selectedLogEntry,
  loadLogs, goToPage,
  handleCleanup, toggleExpand, openLogDetail,
} = useLogs()

const pageNumbers = computed(() => {
  const tp = totalPages.value
  const current = page.value
  if (tp <= MAX_PAGE_BUTTONS) return Array.from({ length: tp }, (_, i) => i + 1)

  const pages: (number | '...')[] = [FIRST_PAGE]
  const start = Math.max(FIRST_PAGE + 1, current - PAGE_NEIGHBORS)
  const end = Math.min(tp - FIRST_PAGE, current + PAGE_NEIGHBORS)

  if (start > FIRST_PAGE + PAGE_NEIGHBORS) pages.push('...')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < tp - PAGE_NEIGHBORS) pages.push('...')
  pages.push(tp)

  return pages
})

const { retentionDays, retentionSaving, saveRetention, loadRetention } = useLogRetention()

let filterTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [period, dateRange, providerFilter, modelFilter, keyFilter],
  () => {
    page.value = 1
    if (filterTimer) clearTimeout(filterTimer)
    filterTimer = setTimeout(() => loadLogs(buildFilterParams()), DEBOUNCE_MS)
  },
  { deep: true },
)

onMounted(() => {
  loadLogs(buildFilterParams())
  loadRetention()
})
</script>
