import { useCallback, useEffect, useState, type RefObject } from 'react'

type UseDeferredRenderOptions = {
  enabled: boolean
  immediate?: boolean
  root?: RefObject<Element | null>
  rootMargin?: string
  debounceMs?: number
  idleTimeoutMs?: number
}

type IdleCallbackHandle = number
type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void

function scheduleIdle(callback: IdleCallback, timeout: number): IdleCallbackHandle {
  const candidate = window as typeof window & {
    requestIdleCallback?: (cb: IdleCallback, opts?: { timeout: number }) => number
  }
  if (typeof candidate.requestIdleCallback === 'function') {
    return candidate.requestIdleCallback(callback, { timeout })
  }
  return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1)
}

function cancelIdle(handle: IdleCallbackHandle): void {
  const candidate = window as typeof window & {
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof candidate.cancelIdleCallback === 'function') {
    candidate.cancelIdleCallback(handle)
    return
  }
  window.clearTimeout(handle)
}

export function useDeferredRender<T extends Element>({
  enabled,
  immediate = false,
  root,
  rootMargin = '300px',
  debounceMs = 300,
  idleTimeoutMs = 500
}: UseDeferredRenderOptions): {
  ref: (node: T | null) => void
  shouldRender: boolean
} {
  const [node, setNode] = useState<T | null>(null)
  const [shouldRender, setShouldRender] = useState(() => enabled && immediate)

  const ref = useCallback((nextNode: T | null) => {
    setNode(nextNode)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setShouldRender(false)
      return
    }
    if (immediate) {
      setShouldRender(true)
      return
    }
    setShouldRender(false)
  }, [enabled, immediate, node])

  useEffect(() => {
    if (!enabled || immediate || shouldRender || !node) return

    let debounceId: number | null = null
    let idleId: IdleCallbackHandle | null = null

    const clearPending = (): void => {
      if (debounceId !== null) {
        window.clearTimeout(debounceId)
        debounceId = null
      }
      if (idleId !== null) {
        cancelIdle(idleId)
        idleId = null
      }
    }

    const scheduleRender = (): void => {
      if (debounceId !== null || idleId !== null) return
      debounceId = window.setTimeout(() => {
        debounceId = null
        idleId = scheduleIdle(() => {
          idleId = null
          setShouldRender(true)
        }, idleTimeoutMs)
      }, debounceMs)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting)
        if (isVisible) {
          scheduleRender()
        } else {
          clearPending()
        }
      },
      {
        root: root?.current ?? null,
        rootMargin
      }
    )

    observer.observe(node)

    return () => {
      observer.disconnect()
      clearPending()
    }
  }, [debounceMs, enabled, idleTimeoutMs, immediate, node, root, rootMargin, shouldRender])

  return { ref, shouldRender }
}
