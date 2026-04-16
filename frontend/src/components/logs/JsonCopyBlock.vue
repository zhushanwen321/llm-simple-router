<template>
  <div class="relative">
    <Button
      variant="outline"
      size="sm"
      class="absolute top-2 right-2 h-7 text-xs"
      @click="handleCopy"
    >
      {{ copied ? '已复制' : '复制' }}
    </Button>
    <pre class="bg-gray-900 text-gray-100 rounded-md p-3 text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap break-all">{{ content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ content: string }>()
const copied = ref(false)

async function handleCopy() {
  await navigator.clipboard.writeText(props.content)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
</script>
