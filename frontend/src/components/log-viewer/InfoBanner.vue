<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'

defineProps<{
  icon?: string
  title: string
  subtitle?: string
  details?: string[]
}>()
</script>

<template>
  <Card class="border-teal-200 dark:border-teal-800">
    <CardContent class="p-3 flex items-center gap-3 bg-teal-50 dark:bg-teal-900">
      <div class="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold">
        {{ icon }}
      </div>
      <div class="flex-1">
        <div class="text-sm font-medium text-teal-900 dark:text-teal-100">{{ title }}</div>
        <div v-if="subtitle" class="text-xs text-teal-700 dark:text-teal-300">{{ subtitle }}</div>
      </div>
      <div v-if="details?.length" class="text-right text-xs text-teal-700 dark:text-teal-300 space-y-0.5">
        <div v-for="d in details" :key="d">{{ d }}</div>
      </div>
    </CardContent>
  </Card>
</template>
