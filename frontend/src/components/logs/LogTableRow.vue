<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckIcon, CopyIcon } from 'lucide-vue-next'
import type { LogEntry } from '@/components/logs/types'
import { PROVIDER_ID_ROUTER } from '@/components/logs/types'
import { formatTime } from '@/utils/format'
import { useClipboard } from '@/composables/useClipboard'

withDefaults(defineProps<{
  log: LogEntry
  isChild?: boolean
  expanded?: boolean
}>(), {
  isChild: false,
  expanded: false,
})

const emit = defineEmits<{
  toggleExpand: [log: LogEntry]
  openDetail: [id: string]
}>()

const { copied, copy } = useClipboard()

function enhancementLabel(raw: string | null): string {
  if (!raw) return '未知'
  try {
    const meta = JSON.parse(raw)
    if (meta.action) {
      return meta.detail ? `${meta.action}: ${meta.detail}` : meta.action
    }
    return raw
  } catch { return '未知' }
}

</script>

<template>
  <TableRow
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
        <span
          class="text-xs transition-transform"
          :class="expanded ? '' : '-rotate-90'"
        >&#9660;</span>
      </Button>
      <span v-if="isChild" class="ml-4 text-muted-foreground text-xs">&#x2514;</span>
    </TableCell>

    <TableCell
      class="font-mono text-xs text-muted-foreground"
      :title="log.id"
    >
      <span class="inline-flex items-center gap-1">
        {{ log.id.slice(0, 8) }}
        <TooltipProvider>
          <Tooltip :delay-duration="300">
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                class="shrink-0"
                @click.stop="copy(log.id)"
              >
                <CheckIcon v-if="copied" class="size-3 text-success" />
                <CopyIcon v-else class="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>复制完整 ID</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    </TableCell>

    <TableCell class="text-muted-foreground">{{ formatTime(log.created_at) }}</TableCell>

    <TableCell>
      <Badge :variant="log.api_type === 'openai' ? 'default' : 'secondary'">
        {{ log.api_type }}
      </Badge>
    </TableCell>

    <TableCell class="font-mono text-xs">
      {{ log.model || '-' }}
      <Badge
        v-if="!isChild && log.original_model"
        variant="secondary"
        class="ml-1 text-xs"
      >已替换</Badge>
    </TableCell>

    <TableCell class="text-xs">
      <template v-if="!isChild && log.provider_id === PROVIDER_ID_ROUTER">
        <Badge variant="secondary" class="text-[10px] px-1 py-0">
          代理增强：{{ enhancementLabel(log.upstream_request) }}
        </Badge>
      </template>
      <template v-else-if="log.backend_model || log.provider_name">
        <span class="font-mono">{{ log.backend_model || '-' }}</span>
        <span class="text-muted-foreground"> @ </span>
        <Badge variant="outline" class="text-[10px] px-1 py-0">
          {{ log.provider_name || log.provider_id || '-' }}
        </Badge>
      </template>
      <span v-else class="text-muted-foreground">-</span>
    </TableCell>

    <TableCell>
      <Badge :variant="(log.status_code ?? 0) < 400 ? 'default' : 'destructive'">
        {{ log.status_code || '-' }}
      </Badge>
    </TableCell>

    <TableCell>{{ log.latency_ms ? log.latency_ms + 'ms' : '-' }}</TableCell>
    <TableCell>{{ log.is_stream ? 'Yes' : 'No' }}</TableCell>

    <TableCell>
      <Badge v-if="log.is_retry" variant="outline" class="text-warning-dark border-warning">重试</Badge>
      <span v-else class="text-muted-foreground">-</span>
    </TableCell>

    <TableCell>
      <Badge v-if="log.is_failover" variant="outline" class="text-danger-dark border-danger">故障转移</Badge>
      <span v-else class="text-muted-foreground">-</span>
    </TableCell>

    <TableCell class="text-destructive text-xs">{{ log.error_message || '-' }}</TableCell>

    <TableCell>
      <Button variant="ghost" size="sm" @click="emit('openDetail', log.id)">详情</Button>
    </TableCell>
  </TableRow>
</template>
