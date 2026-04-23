export const ROLE_CLASSES: Record<string, string> = {
  system: 'bg-muted text-muted-foreground',
  user: 'bg-info-light text-info-dark dark:text-info',
  assistant: 'bg-success-light text-success-dark dark:text-success',
  tool: 'bg-warning-light text-warning-dark dark:text-warning',
}

export const BLOCK_CLASSES: Record<string, string> = {
  thinking: 'bg-info-light text-info-dark dark:text-info',
  tool_use: 'bg-warning-light text-warning-dark dark:text-warning',
  tool_result: 'bg-success-light text-success-dark dark:text-success',
  text: 'bg-success-light text-success-dark dark:text-success',
  error: 'bg-danger-light text-danger-dark dark:text-danger',
}

export const BLOCK_BORDER_CLASSES: Record<string, string> = {
  thinking: 'border-info',
  tool_use: 'border-warning',
  tool_result: 'border-success',
  text: 'border-success',
  error: 'border-danger',
}

export const TAG_CLASSES: Record<string, string> = {
  'system-reminder': 'bg-muted text-muted-foreground',
  'thinking': 'bg-info-light text-info-dark dark:text-info',
  'antml:function_calls': 'bg-warning-light text-warning-dark dark:text-warning',
  'antml:function_results': 'bg-success-light text-success-dark dark:text-success',
  'tool_use': 'bg-warning-light text-warning-dark dark:text-warning',
  'tool_result': 'bg-success-light text-success-dark dark:text-success',
  'env-info': 'bg-info-light text-info-dark dark:text-info',
  'feedback': 'bg-warning-light text-warning-dark dark:text-warning',
  'error': 'bg-danger-light text-danger-dark dark:text-danger',
  'local-command-caveat': 'bg-muted text-muted-foreground',
  'local-command-stdout': 'bg-muted text-muted-foreground',
  'command-name': 'bg-info-light text-info-dark dark:text-info',
  'command-message': 'bg-info-light text-info-dark dark:text-info',
  'command-args': 'bg-info-light text-info-dark dark:text-info',
}

const FALLBACK = 'bg-muted text-muted-foreground'
export const roleClass = (role: string) => ROLE_CLASSES[role] ?? FALLBACK
export const blockClass = (type: string) => BLOCK_CLASSES[type] ?? FALLBACK
export const blockBorderClass = (type: string) => BLOCK_BORDER_CLASSES[type] ?? 'border-muted'
export const tagClass = (tag: string) => TAG_CLASSES[tag] ?? FALLBACK
