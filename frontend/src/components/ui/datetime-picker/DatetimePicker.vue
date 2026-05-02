<script setup lang="ts">
/**
 * Locale-aware datetime picker.
 * Replaces native <input type="datetime-local"> which ignores app locale.
 * Uses date-fns for locale-aware formatting + Popover with date/time selects.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { format, parse } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const DATE_FMT = 'yyyy-MM-dd'
const TIME_FMT = 'HH:mm'
const ISO_FMT = `${DATE_FMT}'T'${TIME_FMT}`

const dateFnsLocales: Record<string, typeof zhCN> = { 'zh-CN': zhCN, en: enUS }

const props = defineProps<{
  modelValue?: string
  class?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { locale } = useI18n()
const open = ref(false)

// Internal state
const inputDate = ref('')
const inputHour = ref('00')
const inputMinute = ref('00')

// Parse modelValue → internal state
watch(() => props.modelValue, (val) => {
  if (!val) {
    inputDate.value = ''
    inputHour.value = '00'
    inputMinute.value = '00'
    return
  }
  try {
    const d = parse(val, ISO_FMT, new Date())
    inputDate.value = format(d, DATE_FMT)
    inputHour.value = format(d, 'HH')
    inputMinute.value = format(d, 'mm')
  } catch {
    // Fallback: try native Date parsing
    const d = new Date(val)
    if (!isNaN(d.getTime())) {
      inputDate.value = format(d, DATE_FMT)
      inputHour.value = format(d, 'HH')
      inputMinute.value = format(d, 'mm')
    }
  }
}, { immediate: true })

// Emit on internal change
function emitValue() {
  if (!inputDate.value) return
  const val = `${inputDate.value}T${inputHour.value}:${inputMinute.value}`
  emit('update:modelValue', val)
}

// Display text
const displayText = computed(() => {
  if (!props.modelValue) return ''
  try {
    const d = parse(props.modelValue, ISO_FMT, new Date())
    const dfnsLocale = dateFnsLocales[locale.value] ?? enUS
    return format(d, 'PPp', { locale: dfnsLocale })
  } catch {
    return props.modelValue
  }
})

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        :class="cn('h-8 justify-start text-left font-normal px-2.5', !modelValue && 'text-muted-foreground', props.class)"
      >
        <span class="truncate">{{ displayText || placeholder || 'Select date & time' }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-3 z-[200]" align="start">
      <div class="space-y-3">
        <!-- Date input -->
        <div>
          <Input
            v-model="inputDate"
            type="date"
            class="h-8 text-sm"
            @change="emitValue"
          />
        </div>
        <!-- Time selects -->
        <div class="flex items-center gap-2">
          <select
            v-model="inputHour"
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            @change="emitValue"
          >
            <option v-for="h in hours" :key="h" :value="h">{{ h }}</option>
          </select>
          <span class="text-muted-foreground font-bold">:</span>
          <select
            v-model="inputMinute"
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            @change="emitValue"
          >
            <option v-for="m in minutes" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
