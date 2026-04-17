<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

defineProps<{
  label: string
}>()
</script>

<template>
  <Badge variant="outline" class="font-mono text-[10px] rounded-full px-2 py-0.5">
    {{ label }}
  </Badge>
</template>
