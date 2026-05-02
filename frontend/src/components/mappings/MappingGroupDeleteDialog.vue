<template>
  <AlertDialog :open="!!target" @update:open="(val: boolean) => { if (!val) emit('cancel') }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('mappings.confirmDeleteTitle') }}</AlertDialogTitle>
        <AlertDialogDescription>{{ t('mappings.confirmDeleteDesc', { model: target?.client_model }) }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
        <Button variant="destructive" @click="emit('confirm')">{{ t('common.delete') }}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import type { MappingGroup } from '@/types/mapping'

const { t } = useI18n()

defineProps<{
  target: MappingGroup | null
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>
