<template>
  <AlertDialog :open="!!target" @update:open="(val: boolean) => { if (!val) emit('cancel') }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>确认删除</AlertDialogTitle>
        <AlertDialogDescription>确定要删除分组「{{ target?.client_model }}」吗？</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <Button variant="destructive" @click="emit('confirm')">删除</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'

interface MappingGroup {
  id: string
  client_model: string
  strategy: string
  rule: string
  created_at: string
}

defineProps<{
  target: MappingGroup | null
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>
