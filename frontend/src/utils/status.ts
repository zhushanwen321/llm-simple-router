export type StatusVariant = 'default' | 'destructive' | 'secondary' | 'outline'

export function statusVariant(status: string): StatusVariant {
  switch (status) {
    case 'pending': return 'default'
    case 'failed': return 'destructive'
    case 'completed': return 'secondary'
    default: return 'outline'
  }
}

import { i18n } from '@/i18n'

export function statusLabel(status: string): string {
  const { t } = i18n.global
  switch (status) {
    case 'pending': return t('common.statusPending')
    case 'failed': return t('common.statusFailed')
    case 'completed': return t('common.statusCompleted')
    default: return status
  }
}
