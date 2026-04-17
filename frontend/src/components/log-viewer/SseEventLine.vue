<script setup lang="ts">
defineProps<{
  eventType: string
  summary: string
  highlight?: boolean
}>()
</script>

<template>
  <div
    class="px-3 py-2 flex items-center gap-2"
    :class="highlight ? 'bg-warning/10' : ''"
  >
    <span
      class="px-1.5 py-0.5 rounded text-[10px] font-medium"
      :class="{
        'bg-teal-200 text-teal-700 dark:bg-teal-800 dark:text-teal-300': eventType === 'message_start',
        'bg-teal-300 text-teal-700 dark:bg-teal-700 dark:text-teal-200': eventType === 'content_block_start',
        'bg-muted text-muted-foreground': eventType === 'content_block_delta',
        'bg-teal-500 text-white dark:bg-teal-600': eventType === 'message_delta',
        'bg-success-light text-success': eventType === 'message_stop',
      }"
    >{{ eventType }}</span>
    <span class="text-xs text-foreground">{{ summary }}</span>
  </div>
</template>
