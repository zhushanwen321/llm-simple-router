<template>
  <div v-if="loading" class="py-8 text-center text-muted-foreground">{{ t('common.loading') }}</div>
  <div v-else-if="sessions.length === 0" class="py-8 text-center text-muted-foreground">{{ t('proxyEnhancement.sessions.noSessions') }}</div>
  <Table v-else>
    <TableHeader>
      <TableRow>
        <TableHead>{{ t('proxyEnhancement.sessions.keyName') }}</TableHead>
        <TableHead>{{ t('proxyEnhancement.sessions.sessionId') }}</TableHead>
        <TableHead>{{ t('proxyEnhancement.sessions.currentModel') }}</TableHead>
        <TableHead>{{ t('proxyEnhancement.sessions.originalModel') }}</TableHead>
        <TableHead>{{ t('proxyEnhancement.sessions.lastActive') }}</TableHead>
        <TableHead>{{ t('proxyEnhancement.sessions.actions') }}</TableHead>
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
                {{ historyMap[session.session_id] ? t('proxyEnhancement.sessions.collapse') : t('proxyEnhancement.sessions.history') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                @click="openClearDialog(session)"
              >
                {{ t('proxyEnhancement.sessions.clear') }}
              </Button>
            </div>
          </TableCell>
        </TableRow>
        <TableRow v-if="historyMap[session.session_id]">
          <TableCell colspan="6" class="bg-muted/50 px-6 py-3">
            <div class="space-y-2">
              <p class="text-sm font-medium text-foreground">{{ t('proxyEnhancement.sessions.switchHistory') }}</p>
              <div
                v-for="entry in historyMap[session.session_id]"
                :key="entry.id"
                class="flex items-center gap-3 text-sm"
              >
                <span class="text-muted-foreground whitespace-nowrap">{{ formatTime(entry.created_at) }}</span>
                <Badge variant="outline" class="text-xs">{{ entry.trigger_type }}</Badge>
                <span>
                  <span class="text-muted-foreground">{{ entry.old_model || t('proxyEnhancement.sessions.default') }}</span>
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

  <AlertDialog :open="showClearDialog" @update:open="showClearDialog = $event">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('proxyEnhancement.sessions.confirmClearTitle') }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t('proxyEnhancement.sessions.confirmClearDescription') }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
        <AlertDialogAction @click="handleClear">{{ t('proxyEnhancement.sessions.confirmClear') }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SessionState, SessionHistoryEntry } from '@/api/client'
import { formatTime, parseUtc } from '@/utils/format'
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

const { t } = useI18n()

const showClearDialog = ref(false)
const sessionToClear = ref<SessionState | null>(null)

function openClearDialog(session: SessionState) {
  sessionToClear.value = session
  showClearDialog.value = true
}

function handleClear() {
  if (sessionToClear.value) {
    emit('clear', sessionToClear.value)
    sessionToClear.value = null
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
  const diff = Date.now() - parseUtc(iso).getTime()
  const minutes = Math.floor(diff / MS_PER_MINUTE)
  if (minutes < 1) return t('proxyEnhancement.sessions.justNow')
  if (minutes < MINUTES_PER_HOUR) return t('proxyEnhancement.sessions.minutesAgo', { minutes })
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return t('proxyEnhancement.sessions.hoursAgo', { hours })
  return t('proxyEnhancement.sessions.daysAgo', { days: Math.floor(hours / HOURS_PER_DAY) })
}
</script>
