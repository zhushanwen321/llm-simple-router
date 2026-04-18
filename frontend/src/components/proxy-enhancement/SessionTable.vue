<template>
  <div v-if="loading" class="py-8 text-center text-muted-foreground">加载中...</div>
  <div v-else-if="sessions.length === 0" class="py-8 text-center text-muted-foreground">暂无活跃 Session</div>
  <Table v-else>
    <TableHeader>
      <TableRow>
        <TableHead>密钥名称</TableHead>
        <TableHead>Session ID</TableHead>
        <TableHead>当前模型</TableHead>
        <TableHead>原始模型</TableHead>
        <TableHead>最后活跃</TableHead>
        <TableHead>操作</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <template v-for="session in sessions" :key="session.id">
        <TableRow>
          <TableCell class="font-medium">{{ session.router_key_name }}</TableCell>
          <TableCell>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="cursor-default font-mono text-xs">{{ shortId(session.session_id) }}</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p class="font-mono text-xs">{{ session.session_id }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </TableCell>
          <TableCell>
            <Badge variant="secondary">{{ session.current_model }}</Badge>
          </TableCell>
          <TableCell>
            <span v-if="session.original_model" class="text-muted-foreground">{{ session.original_model }}</span>
            <span v-else class="text-muted-foreground">-</span>
          </TableCell>
          <TableCell class="text-muted-foreground text-sm">{{ relativeTime(session.last_active_at) }}</TableCell>
          <TableCell>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" @click="$emit('viewHistory', session)">
                {{ historyMap[session.session_id] ? '收起' : '历史' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                @click="clearingSession = session"
              >
                清除
              </Button>
            </div>
          </TableCell>
        </TableRow>
        <TableRow v-if="historyMap[session.session_id]">
          <TableCell colspan="6" class="bg-muted/50 px-6 py-3">
            <div class="space-y-2">
              <p class="text-sm font-medium text-foreground">切换历史</p>
              <div
                v-for="entry in historyMap[session.session_id]"
                :key="entry.id"
                class="flex items-center gap-3 text-sm"
              >
                <span class="text-muted-foreground whitespace-nowrap">{{ formatTime(entry.created_at) }}</span>
                <Badge variant="outline" class="text-xs">{{ entry.trigger_type }}</Badge>
                <span>
                  <span class="text-muted-foreground">{{ entry.old_model || '默认' }}</span>
                  <span class="mx-1">&rarr;</span>
                  <span class="font-medium">{{ entry.new_model }}</span>
                </span>
              </div>
            </div>
          </TableCell>
        </TableRow>
      </template>
    </TableBody>
  </Table>

  <AlertDialog :open="!!clearingSession" @update:open="clearingSession = null">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>确认清除 Session</AlertDialogTitle>
        <AlertDialogDescription>
          清除后，该 Session 将恢复使用默认模型映射。此操作不可撤销。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="clearingSession = null">取消</AlertDialogCancel>
        <AlertDialogAction @click="handleClear">确认清除</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { SessionState, SessionHistoryEntry } from '@/api/client'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'

defineProps<{
  sessions: SessionState[]
  loading: boolean
  historyMap: Record<string, SessionHistoryEntry[]>
}>()

const emit = defineEmits<{
  clear: [session: SessionState]
  viewHistory: [session: SessionState]
}>()

const clearingSession = ref<SessionState | null>(null)

function handleClear() {
  if (clearingSession.value) {
    emit('clear', clearingSession.value)
    clearingSession.value = null
  }
}

const SHORT_ID_LENGTH = 8
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH) + '...'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / MS_PER_MINUTE)
  if (minutes < 1) return '刚刚'
  if (minutes < MINUTES_PER_HOUR) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours} 小时前`
  return `${Math.floor(hours / HOURS_PER_DAY)} 天前`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}
</script>
