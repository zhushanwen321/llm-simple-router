<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

defineProps<{
  label: string
  value: string
  highlight?: boolean
}>()
</script>

<template>
  <Badge
    :variant="highlight ? 'default' : 'secondary'"
    class="font-mono text-sm px-3 py-1.5 rounded-md gap-1"
  >
    <span class="opacity-70">{{ label }}:</span>
    {{ value }}
  </Badge>
</template>
