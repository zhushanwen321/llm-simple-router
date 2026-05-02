<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">{{ t('logs.title') }}</h2>
      <Button
        variant="outline"
        class="text-destructive border-destructive hover:bg-destructive/10"
        @click="showCleanup = true"
      >
        {{ t('logs.cleanupLogs') }}
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
        <Button
          v-if="dateRange.start || dateRange.end"
          variant="ghost"
          size="sm"
          @click="clearDateRange"
          >{{ t('logs.clear') }}</Button
        >
        <span
          v-if="dateRangeError"
          class="text-xs text-destructive whitespace-nowrap"
          >{{ dateRangeError }}</span
        >
      </div>
      <Select v-model="providerFilter">
        <SelectTrigger class="w-28 truncate">
          <SelectValue :placeholder="t('logs.allProviders')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('logs.allProviders') }}</SelectItem>
          <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{
            p.name
          }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="modelFilter">
        <SelectTrigger class="w-32 truncate">
          <SelectValue :placeholder="t('logs.allModels')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('logs.allModels') }}</SelectItem>
          <SelectItem v-for="m in filteredModelOptions" :key="m" :value="m">{{
            m
          }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="keyFilter">
        <SelectTrigger class="w-32 truncate">
          <SelectValue :placeholder="t('logs.allKeys')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('logs.allKeys') }}</SelectItem>
          <SelectItem v-for="rk in routerKeys" :key="rk.id" :value="rk.id">{{
            rk.name
          }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="statusFilter">
        <SelectTrigger class="w-28 truncate">
          <SelectValue :placeholder="t('logs.allStatus')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('logs.allStatus') }}</SelectItem>
          <SelectItem value="200">200</SelectItem>
          <SelectItem value="non200">{{ t('logs.non200') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="w-10"></TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.id') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.time') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.type') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.model') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.actualForward') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.statusCode') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.latency') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.streaming') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.retry') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.failover') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.error') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('logs.table.actions') }}</TableHead>
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
                <TableCell
                  :colspan="TABLE_COL_COUNT"
                  class="text-center py-2 pl-10"
                >
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
            <TableCell
              :colspan="TABLE_COL_COUNT"
              class="text-center text-muted-foreground py-8"
              >{{ t('logs.noLogs') }}</TableCell
            >
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex items-center justify-between mt-4">
      <p class="text-sm text-muted-foreground">
        {{ t('logs.pagination', { total, page, totalPages }) }}
      </p>
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          @click="goToPage(1)"
          :disabled="page <= 1"
          >{{ t('logs.firstPage') }}</Button
        >
        <Button
          variant="outline"
          size="sm"
          @click="goToPage(page - 1)"
          :disabled="page <= 1"
          >{{ t('logs.prevPage') }}</Button
        >
        <template v-for="item in pageNumbers" :key="item">
          <span v-if="item === '...'" class="px-2 text-sm text-muted-foreground"
            >...</span
          >
          <Button
            v-else
            :variant="item === page ? 'default' : 'outline'"
            size="sm"
            class="min-w-8"
            @click="goToPage(item)"
            >{{ item }}</Button
          >
        </template>
        <Button
          variant="outline"
          size="sm"
          @click="goToPage(page + 1)"
          :disabled="page >= totalPages"
          >{{ t('logs.nextPage') }}</Button
        >
        <Button
          variant="outline"
          size="sm"
          @click="goToPage(totalPages)"
          :disabled="page >= totalPages"
          >{{ t('logs.lastPage') }}</Button>
        >
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
          <DialogTitle>{{ t('logs.cleanup.title') }}</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">{{ t('logs.cleanup.description') }}</p>
        <div class="mb-4">
          <Label class="block text-sm font-medium text-foreground mb-1"
            >{{ t('logs.cleanup.keepRecentDays') }}</Label
          >
          <Input v-model.number="cleanupDays" type="number" :min="1" />
        </div>
        <Separator />
        <div class="space-y-3">
          <div class="text-sm font-medium">{{ t('logs.cleanup.autoCleanup') }}</div>
          <div class="flex items-center gap-3">
            <Label class="whitespace-nowrap">{{ t('logs.cleanup.retentionDays') }}</Label>
            <Input
              type="number"
              v-model.number="retentionDays"
              :min="0"
              :max="90"
              class="w-20"
            />
            <span class="text-xs text-muted-foreground">{{ t('logs.cleanup.noAutoCleanup') }}</span>
          </div>
          <div class="flex justify-end">
            <Button
              size="sm"
              @click="saveRetention"
              :disabled="retentionSaving"
            >
              {{ t('logs.cleanup.saveSettings') }}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCleanup = false">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" @click="handleCleanup">{{ t('logs.cleanup.confirmCleanup') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Cleanup result dialog -->
    <AlertDialog v-model:open="showCleanupResult">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('logs.cleanupResult.title') }}</AlertDialogTitle>
          <AlertDialogDescription
            >{{ t('logs.cleanupResult.description', { count: cleanupResult }) }}</AlertDialogDescription
          >
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction @click="showCleanupResult = false"
            >{{ t('logs.cleanupResult.ok') }}</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import UnifiedRequestDialog from "@/components/request-detail/UnifiedRequestDialog.vue";
import LogTableRow from "@/components/logs/LogTableRow.vue";
import { useLogFilters } from "@/composables/useLogFilters";
import { useLogs } from "@/composables/useLogs";
import { useLogRetention } from "@/composables/useLogRetention";

const { t } = useI18n();

const {
  PERIODS,
  period,
  dateRange,
  dateRangeError,
  providerFilter,
  modelFilter,
  keyFilter,
  statusFilter,
  providers,
  routerKeys,
  filteredModelOptions,
  clearDateRange,
  buildFilterParams,
} = useLogFilters();

const TABLE_COL_COUNT = 13;
const DEBOUNCE_MS = 300;
const MAX_PAGE_BUTTONS = 7;
const PAGE_NEIGHBORS = 2;
const FIRST_PAGE = 1;

const {
  logs,
  total,
  page,
  totalPages,
  cleanupDays,
  showCleanup,
  cleanupResult,
  showCleanupResult,
  expandedRows,
  childLogs,
  childLoading,
  logDetailOpen,
  selectedLogEntry,
  loadLogs,
  goToPage,
  handleCleanup,
  toggleExpand,
  openLogDetail,
} = useLogs();

const pageNumbers = computed(() => {
  const tp = totalPages.value;
  const current = page.value;
  if (tp <= MAX_PAGE_BUTTONS)
    return Array.from({ length: tp }, (_, i) => i + 1);

  const pages: (number | "...")[] = [FIRST_PAGE];
  const start = Math.max(FIRST_PAGE + 1, current - PAGE_NEIGHBORS);
  const end = Math.min(tp - FIRST_PAGE, current + PAGE_NEIGHBORS);

  if (start > FIRST_PAGE + PAGE_NEIGHBORS) pages.push("...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < tp - PAGE_NEIGHBORS) pages.push("...");
  pages.push(tp);

  return pages;
});

const { retentionDays, retentionSaving, saveRetention, loadRetention } =
  useLogRetention();

let filterTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  [period, dateRange, providerFilter, modelFilter, keyFilter, statusFilter],
  () => {
    page.value = 1;
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadLogs(buildFilterParams()), DEBOUNCE_MS);
  },
  { deep: true },
);

onMounted(() => {
  loadLogs(buildFilterParams());
  loadRetention();
});
</script>
