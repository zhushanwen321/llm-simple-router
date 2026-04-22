import { onUnmounted } from 'vue'

type SSEEventHandler = (event: MessageEvent) => void

export interface SSEEventMap {
  [eventType: string]: SSEEventHandler
}

export interface SSECallbacks {
  onOpen?: () => void
  onClose?: () => void
}

/**
 * SSE 连接生命周期管理。
 * 负责 EventSource 创建/关闭、消息监听、断线重连。
 * 组件卸载时自动关闭连接。
 */
export function useMonitorSSE(
  url: string,
  handlers: SSEEventMap,
  callbacks?: SSECallbacks,
) {
  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const RECONNECT_DELAY = 3000

  function connect(): void {
    if (eventSource) return

    eventSource = new EventSource(url)

    eventSource.onopen = () => {
      callbacks?.onOpen?.()
    }

    for (const [type, handler] of Object.entries(handlers)) {
      eventSource.addEventListener(type, handler)
    }

    eventSource.onerror = () => {
      cleanup()
      callbacks?.onClose?.()
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY)
    }
  }

  function cleanup(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  onUnmounted(() => {
    cleanup()
    callbacks?.onClose?.()
  })

  return { connect, disconnect: cleanup }
}
