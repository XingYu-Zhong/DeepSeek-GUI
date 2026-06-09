import { useEffect, type RefObject } from 'react'

type UseWriteSplitScrollSyncOptions = {
  enabled: boolean
  editorRootRef: RefObject<HTMLElement | null>
  previewRef: RefObject<HTMLElement | null>
  rebindKey?: unknown
}

export function useWriteSplitScrollSync({
  enabled,
  editorRootRef,
  previewRef,
  rebindKey
}: UseWriteSplitScrollSyncOptions): void {
  useEffect(() => {
    if (!enabled) return

    const editor = editorRootRef.current?.querySelector<HTMLElement>('.cm-scroller') ?? null
    const preview = previewRef.current
    if (!editor || !preview) return

    const echo = { editor: 0, preview: 0 }

    const bindSync = (
      source: HTMLElement,
      target: HTMLElement,
      sourceKey: 'editor' | 'preview',
      targetKey: 'editor' | 'preview'
    ) => {
      let pending = false

      return () => {
        if (echo[sourceKey] > 0) {
          echo[sourceKey] -= 1
          return
        }
        if (pending) return

        pending = true
        window.requestAnimationFrame(() => {
          pending = false
          const sourceRange = source.scrollHeight - source.clientHeight
          const targetRange = target.scrollHeight - target.clientHeight
          if (sourceRange <= 0 || targetRange <= 0) return

          const ratio = source.scrollTop / sourceRange
          const nextTop = ratio * targetRange
          if (Math.abs(target.scrollTop - nextTop) < 1) return

          echo[targetKey] += 1
          target.scrollTop = nextTop
        })
      }
    }

    const onEditorScroll = bindSync(editor, preview, 'editor', 'preview')
    const onPreviewScroll = bindSync(preview, editor, 'preview', 'editor')

    editor.addEventListener('scroll', onEditorScroll, { passive: true })
    preview.addEventListener('scroll', onPreviewScroll, { passive: true })

    return () => {
      editor.removeEventListener('scroll', onEditorScroll)
      preview.removeEventListener('scroll', onPreviewScroll)
    }
  }, [enabled, editorRootRef, previewRef, rebindKey])
}
