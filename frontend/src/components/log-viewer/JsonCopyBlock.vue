<template>
  <div class="relative">
    <Button
      v-if="!hideCopyButton"
      variant="outline"
      size="sm"
      class="absolute top-2 right-2 h-7 text-xs"
      @click="handleCopy"
    >
      {{ copied ? '已复制' : '复制' }}
    </Button>
    <pre class="bg-background text-foreground rounded-md p-3 text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap break-all border">{{ content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ content: string; hideCopyButton?: boolean }>()
const COPIED_FEEDBACK_MS = 1500

const copied = ref(false)

async function handleCopy() {
  await navigator.clipboard.writeText(props.content)
  copied.value = true
  setTimeout(() => { copied.value = false }, COPIED_FEEDBACK_MS)
}
</script>
