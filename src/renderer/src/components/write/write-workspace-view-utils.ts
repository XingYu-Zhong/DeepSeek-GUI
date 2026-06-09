import { useEffect, useState, type ReactElement } from 'react'
import type { WriteExportFormat } from '@shared/write-export'
import type { WritePreviewMode, WriteSaveStatus } from '../../write/write-workspace-store'

export const WRITE_AUTOSAVE_MS = 900
export const WRITE_PREVIEW_DEBOUNCE_MS = 60
export const INLINE_AGENT_MIN_WIDTH = 280
export const INLINE_AGENT_MAX_WIDTH = 440
export const INLINE_AGENT_FALLBACK_HEIGHT = 56
export const WRITE_EXPORT_NOTICE_MS = 3_600
export const INLINE_EDIT_RECENT_CONTEXT_CHARS = 180
export const WRITE_EXPORT_FORMATS: WriteExportFormat[] = ['html', 'pdf', 'doc', 'docx']
export const WRITE_RICH_CLIPBOARD_ACTION = 'clipboard'

export type WriteNotice = {
  tone: 'success' | 'error'
  message: string
}

export type WriteModeMenuItem = {
  mode: WritePreviewMode
  label: string
  shortLabel: string
  icon: ReactElement
  active: boolean
}

export type WriteInlineAgentPosition = {
  left: number
  top: number
  width: number
  origin: 'top-center' | 'bottom-center'
}

export function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath)
}

export function formatSaveLabel(status: WriteSaveStatus, t: (key: string) => string): string {
  if (status === 'saving') return t('writeSaving')
  if (status === 'dirty') return t('writeUnsaved')
  if (status === 'error') return t('writeSaveError')
  return t('writeSaved')
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [value, delayMs])

  return debounced
}

export function inlineAgentPosition(selection: {
  anchorRect?: { left: number; top: number; bottom: number; width: number } | null
}): WriteInlineAgentPosition | null {
  const rect = selection.anchorRect
  if (!rect) return null
  const width = clamp(Math.round(window.innerWidth * 0.24), INLINE_AGENT_MIN_WIDTH, INLINE_AGENT_MAX_WIDTH)
  const height = INLINE_AGENT_FALLBACK_HEIGHT
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const left = clamp(rect.left + rect.width / 2 - width / 2, 16, viewportWidth - width - 16)
  const bottomTop = rect.bottom + 8
  const topTop = rect.top - height - 8
  const useTop = bottomTop + height > viewportHeight - 16 && topTop >= 16
  const top = clamp(useTop ? topTop : bottomTop, 16, viewportHeight - height - 16)
  return {
    left,
    top,
    width,
    origin: useTop ? 'bottom-center' : 'top-center'
  }
}

export function modeButtonClass(active: boolean): string {
  return `inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-[13px] transition ${
    active
      ? 'bg-white text-ds-ink shadow-sm ring-1 ring-ds-border-muted dark:bg-white/10 dark:ring-white/10'
      : 'text-ds-faint hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/8'
  }`
}

export function toolbarIconButtonClass(active = false): string {
  return `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition ${
    active
      ? 'bg-accent/10 text-accent'
      : 'hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/8'
  }`
}

export function toolbarMenuButtonClass(active = false): string {
  return `inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-ds-faint transition ${
    active
      ? 'bg-accent/10 text-accent'
      : 'hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/8'
  }`
}

export function exportFormatLabel(format: WriteExportFormat, t: (key: string) => string): string {
  if (format === 'html') return t('writeExportHtml')
  if (format === 'pdf') return t('writeExportPdf')
  if (format === 'doc') return t('writeExportDoc')
  return t('writeExportDocx')
}
