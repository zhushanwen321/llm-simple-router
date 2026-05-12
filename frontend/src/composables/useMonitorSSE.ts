import { onUnmounted } from 'vue'

type SSEEventHandler = (event: MessageEvent) => void

export interface SSEEventMap {
  [eventType: string]: SSEEventHandler
}

export interface SSECallbacks {
  onOpen?: () => void
  onClose?: () => void
}

/** 页面隐藏后断开 SSE 的阈值时间 */
const VISIBILITY_DISCONNECT_MS = 30000

/**
 * SSE 连接生命周期管理。
 * 负责 EventSource 创建/关闭、消息监听、断线重连。
 * 页面隐藏超过 30s 自动断开，恢复可见时重连。
 * 组件卸载时自动关闭连接。
 */
export function useMonitorSSE(
  url: string,
  handlers: SSEEventMap,
  callbacks?: SSECallbacks,
) {
  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let visibilityTimer: ReturnType<typeof setTimeout> | null = null
  let visibilityListenerAdded = false
  const INITIAL_DELAY = 3000
  const MAX_DELAY = 30000

  function handleVisibilityChange() {
    if (document.hidden) {
      visibilityTimer = setTimeout(() => {
        cleanup()
        callbacks?.onClose?.()
      }, VISIBILITY_DISCONNECT_MS)
    } else {
      if (visibilityTimer) {
        clearTimeout(visibilityTimer)
        visibilityTimer = null
      }
      // 页面恢复可见且 SSE 已断开，自动重连
      if (!eventSource) {
        connect()
      }
    }
  }

  function connect(): void {
    if (eventSource) return

    eventSource = new EventSource(url)

    eventSource.onopen = () => {
      reconnectAttempt = 0
      callbacks?.onOpen?.()
      // 连接成功后注册 visibilitychange 监听（仅一次）
      if (!visibilityListenerAdded && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange)
        visibilityListenerAdded = true
      }
    }

    for (const [type, handler] of Object.entries(handlers)) {
      eventSource.addEventListener(type, handler)
    }

    eventSource.onerror = () => {
      cleanup()
      callbacks?.onClose?.()
      // eslint-disable-next-line no-magic-numbers
      const delay = Math.min(INITIAL_DELAY * Math.pow(2, reconnectAttempt), MAX_DELAY)
      reconnectAttempt++
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  function cleanup(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (visibilityTimer) {
      clearTimeout(visibilityTimer)
      visibilityTimer = null
    }
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  onUnmounted(() => {
    cleanup()
    if (visibilityListenerAdded && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      visibilityListenerAdded = false
    }
    callbacks?.onClose?.()
  })

  return { connect, disconnect: cleanup }
}
