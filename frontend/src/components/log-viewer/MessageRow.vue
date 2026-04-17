<script setup lang="ts">
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

defineProps<{
  role: 'user' | 'assistant' | 'tool'
  content: string
  meta?: string
}>()

const roleConfig: Record<string, { initial: string; bgClass: string; textClass: string }> = {
  user:      { initial: 'U', bgClass: 'bg-role-user-bg',      textClass: 'text-role-user' },
  assistant: { initial: 'A', bgClass: 'bg-role-assistant-bg', textClass: 'text-role-assistant' },
  tool:      { initial: 'T', bgClass: 'bg-role-tool-bg',      textClass: 'text-role-tool' },
}
</script>

<template>
  <div class="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50">
    <Avatar class="w-5 h-5" :class="roleConfig[role].bgClass">
      <AvatarFallback :class="'text-[10px] font-medium ' + roleConfig[role].textClass">
        {{ roleConfig[role].initial }}
      </AvatarFallback>
    </Avatar>
    <span class="text-xs text-foreground flex-1 truncate">{{ content }}</span>
    <span v-if="meta" class="text-[10px] text-muted-foreground">{{ meta }}</span>
  </div>
</template>
