<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckIcon, ChevronDown, CopyIcon } from "lucide-vue-next";
import type { LogEntry } from "@/components/logs/types";
import { PROVIDER_ID_ROUTER } from "@/components/logs/types";
import { formatTimeHMS } from "@/utils/format";

withDefaults(
  defineProps<{
    log: LogEntry;
    isChild?: boolean;
    expanded?: boolean;
    copiedId?: string | null;
  }>(),
  {
    isChild: false,
    expanded: false,
    copiedId: null,
  },
);

const emit = defineEmits<{
  toggleExpand: [log: LogEntry];
  openDetail: [id: string];
  copy: [id: string];
}>();

const { t } = useI18n();

function enhancementLabel(raw: string | null): string {
  if (!raw) return t("logs.row.unknown");
  try {
    const meta = JSON.parse(raw);
    if (meta.action) {
      return meta.detail ? `${meta.action}: ${meta.detail}` : meta.action;
    }
    return raw;
  } catch {
    return t("logs.row.unknown");
  }
}
</script>

<template>
  <TableRow
    class="group"
    :class="{
      'bg-destructive/10': !isChild && (log.status_code ?? 0) >= 400,
      'bg-muted/20': isChild,
    }"
  >
    <TableCell class="w-10">
      <Button
        v-if="!isChild && log.child_count"
        variant="ghost"
        size="xs"
        @click="emit('toggleExpand', log)"
      >
        <ChevronDown
          class="size-3 transition-transform"
          :class="expanded ? '' : '-rotate-90'"
        />
      </Button>
      <span v-if="isChild" class="ml-4 text-muted-foreground text-xs"
        >&#x2514;</span
      >
    </TableCell>

    <TableCell class="font-mono text-xs text-muted-foreground" :title="log.id">
      <span class="inline-flex items-center gap-1">
        {{ log.id.slice(0, 8) }}
        <Tooltip :delay-duration="300">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop="emit('copy', log.id)"
            >
              <CheckIcon
                v-if="copiedId === log.id"
                class="size-3 text-success"
              />
              <CopyIcon v-else class="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("logs.row.copyFullId") }}</TooltipContent>
        </Tooltip>
      </span>
    </TableCell>

    <TableCell
      class="font-mono text-xs text-muted-foreground whitespace-nowrap"
      >{{ formatTimeHMS(log.created_at) }}</TableCell
    >

    <TableCell class="font-mono text-xs whitespace-nowrap">
      {{ log.model || "-" }}
      <Badge variant="secondary" class="ml-1 text-[10px] px-1 py-0">{{
        log.api_type
      }}</Badge>
    </TableCell>

    <TableCell class="text-xs whitespace-nowrap">
      <template v-if="!isChild && log.provider_id === PROVIDER_ID_ROUTER">
        <Badge variant="secondary" class="text-[10px] px-1 py-0">
          {{
            t("logs.row.proxyEnhancement", {
              label: enhancementLabel(log.upstream_request),
            })
          }}
        </Badge>
      </template>
      <template v-else-if="log.backend_model || log.provider_name">
        <span class="font-mono">{{ log.backend_model || "-" }}</span>
        <span class="text-muted-foreground"> @ </span>
        <span class="text-muted-foreground">{{
          log.provider_name || log.provider_id || "-"
        }}</span>
        <Badge variant="secondary" class="ml-1 text-[10px] px-1 py-0">{{
          log.api_type
        }}</Badge>
      </template>
      <span v-else class="text-muted-foreground">-</span>
    </TableCell>

    <TableCell class="font-mono text-xs text-muted-foreground">
      {{
        log.latency_ms != null ? (log.latency_ms / 1000).toFixed(1) + "s" : "-"
      }}
    </TableCell>

    <TableCell>
      <div class="flex flex-wrap gap-1">
        <Badge
          :variant="(log.status_code ?? 0) < 400 ? 'default' : 'destructive'"
          class="text-[10px] px-1.5 py-0"
        >
          {{ log.status_code || "-" }}
        </Badge>
        <Badge
          v-if="log.is_stream"
          variant="outline"
          class="text-[10px] px-1.5 py-0"
        >
          SSE
        </Badge>
        <Badge
          v-if="log.is_retry"
          variant="outline"
          class="text-[10px] px-1.5 py-0 text-warning-dark border-warning"
          >{{ t("logs.table.retry") }}</Badge
        >
        <Badge
          v-if="log.is_failover"
          variant="outline"
          class="text-[10px] px-1.5 py-0 text-danger-dark border-danger"
          >{{ t("logs.table.failover") }}</Badge
        >
      </div>
    </TableCell>

    <TableCell
      class="text-destructive text-xs min-w-0 max-w-60 lg:max-w-xs"
    >
      <template v-if="log.error_message">
        <Tooltip :delay-duration="300">
          <TooltipTrigger as-child>
            <span class="block truncate">{{ log.error_message }}</span>
          </TooltipTrigger>
          <TooltipContent class="max-w-sm whitespace-pre-wrap">{{
            log.error_message
          }}</TooltipContent>
        </Tooltip>
      </template>
      <span v-else class="text-muted-foreground">-</span>
    </TableCell>

    <TableCell>
      <Button variant="ghost" size="sm" @click="emit('openDetail', log.id)">{{
        t("logs.row.detail")
      }}</Button>
    </TableCell>
  </TableRow>
</template>
