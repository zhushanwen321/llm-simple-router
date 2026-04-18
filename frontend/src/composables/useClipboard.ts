import { ref } from 'vue'

const FEEDBACK_MS = 2000

/**
 * 可靠的剪贴板复制 composable。
 * 优先使用 navigator.clipboard.writeText，失败时降级为 textarea + execCommand。
 */
export function useClipboard() {
  const copied = ref(false)

  async function copy(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        fallbackCopy(text)
      }
      copied.value = true
      setTimeout(() => { copied.value = false }, FEEDBACK_MS)
      return true
    } catch {
      try {
        fallbackCopy(text)
        copied.value = true
        setTimeout(() => { copied.value = false }, FEEDBACK_MS)
        return true
      } catch {
        return false
      }
    }
  }

  return { copied, copy }
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  if (!document.execCommand('copy')) {
    throw new Error('execCommand copy failed')
  }
  document.body.removeChild(ta)
}
