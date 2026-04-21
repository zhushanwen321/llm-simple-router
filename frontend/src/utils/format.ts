export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN')
}
