import type { NormalizedThread } from '../agent/types'
import i18n from '../i18n'

const LEGACY_PLACEHOLDER_TITLES = new Set(['New Thread', '新会话'])
const INTERNAL_PLACEHOLDER_TITLE_PATTERN = /^__codex_[a-z0-9_]+__$/i
const MAX_THREAD_TITLE_LENGTH = 48

function normalizeTitleLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/`+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s,.;:!?，。；：！？、'"`()[\]{}]+$/g, '').trim()
}

function shortenTitle(text: string): string {
  if (text.length <= MAX_THREAD_TITLE_LENGTH) return text
  const sliced = text.slice(0, MAX_THREAD_TITLE_LENGTH)
  const lastSpace = sliced.lastIndexOf(' ')
  const compact = lastSpace >= 18 ? sliced.slice(0, lastSpace) : sliced
  return `${compact.trim()}...`
}

export function getDefaultThreadTitle(): string {
  return i18n.t('common:untitledThread')
}

export function deriveThreadTitleFromPrompt(prompt: string): string {
  const fallback = getDefaultThreadTitle()
  const lines = prompt
    .split(/\r?\n/)
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) => normalizeTitleLine(line))
    .filter((line) => line)

  const firstLine = lines[0] ?? normalizeTitleLine(prompt)
  if (!firstLine) return fallback

  const sentenceBreak = firstLine.search(/[。！？.!?]/)
  const core = sentenceBreak >= 8 ? firstLine.slice(0, sentenceBreak) : firstLine
  const trimmed = stripTrailingPunctuation(shortenTitle(core))
  return trimmed || fallback
}

export function isInternalPlaceholderThreadTitle(title: string | null | undefined): boolean {
  const raw = title?.trim() ?? ''
  return INTERNAL_PLACEHOLDER_TITLE_PATTERN.test(raw)
}

export function hasThreadIdFallbackTitle(
  thread: Pick<NormalizedThread, 'id' | 'title'> | null | undefined
): boolean {
  const raw = thread?.title?.trim() ?? ''
  if (!thread || !raw) return false
  return raw === thread.id.slice(0, 8)
}

export function shouldAutoTitleThread(
  thread: Pick<NormalizedThread, 'id' | 'title'> | null | undefined
): boolean {
  const raw = thread?.title?.trim() ?? ''
  if (!raw) return true
  if (raw === getDefaultThreadTitle()) return true
  if (LEGACY_PLACEHOLDER_TITLES.has(raw)) return true
  if (hasThreadIdFallbackTitle(thread)) return true
  return false
}
