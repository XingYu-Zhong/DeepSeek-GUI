import type {
  WriteInlineEditRecentEdit,
  WriteInlineEditRecentEditSource,
  WriteInlineEditScopeKind
} from '@shared/write-inline-edit'

export type WriteRecentEdit = Omit<WriteInlineEditRecentEdit, 'ageMs'> & {
  id: string
  timestamp: number
  filePath: string
}

export type WriteRecentEditInput = {
  source: WriteInlineEditRecentEditSource
  timestamp?: number
  filePath: string
  from: number
  to: number
  deletedText?: string
  insertedText?: string
  beforeContext?: string
  afterContext?: string
  instruction?: string
  scopeKind?: WriteInlineEditScopeKind
}

const MAX_RECENT_EDITS = 48
const RECENT_EDIT_TTL_MS = 2 * 60 * 1_000
const RECENT_EDIT_TEXT_LIMIT = 900
const RECENT_EDIT_CONTEXT_LIMIT = 260
const RECENT_EDIT_PROMPT_LIMIT = 8
const SAME_AREA_DISTANCE = 2_400
const MERGE_TYPING_WINDOW_MS = 3_000

function normalizePath(value = ''): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function pathsEqual(a = '', b = ''): boolean {
  return normalizePath(a) === normalizePath(b)
}

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function clipMiddle(text = '', maxChars = 0): string {
  const source = String(text || '').replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '')
  if (!maxChars || source.length <= maxChars) return source
  const head = Math.max(1, Math.floor(maxChars * 0.56))
  const tail = Math.max(1, maxChars - head - 13)
  return `${source.slice(0, head)}\n... omitted ...\n${source.slice(source.length - tail)}`
}

function nextEditId(input: WriteRecentEditInput, timestamp: number): string {
  return [
    'write-edit',
    timestamp.toString(36),
    input.source,
    clampOffset(input.from).toString(36),
    clampOffset(input.to).toString(36),
    Math.random().toString(36).slice(2, 8)
  ].join('-')
}

export function createWriteRecentEdit(input: WriteRecentEditInput): WriteRecentEdit | null {
  const deletedText = clipMiddle(input.deletedText ?? '', RECENT_EDIT_TEXT_LIMIT)
  const insertedText = clipMiddle(input.insertedText ?? '', RECENT_EDIT_TEXT_LIMIT)
  if (!deletedText && !insertedText) return null

  const timestamp = Number.isFinite(input.timestamp) ? Math.floor(input.timestamp ?? Date.now()) : Date.now()
  const from = clampOffset(input.from)
  const to = clampOffset(Math.max(input.from, input.to))

  return {
    id: nextEditId(input, timestamp),
    timestamp,
    source: input.source,
    filePath: input.filePath,
    from,
    to,
    deletedText,
    insertedText,
    beforeContext: clipMiddle(input.beforeContext ?? '', RECENT_EDIT_CONTEXT_LIMIT),
    afterContext: clipMiddle(input.afterContext ?? '', RECENT_EDIT_CONTEXT_LIMIT),
    instruction: input.instruction?.trim() || undefined,
    scopeKind: input.scopeKind
  }
}

export function trimWriteRecentEdits(
  edits: WriteRecentEdit[],
  now = Date.now()
): WriteRecentEdit[] {
  return mergeAdjacentTypingEdits(edits)
    .filter((edit) => now - edit.timestamp <= RECENT_EDIT_TTL_MS)
    .slice(-MAX_RECENT_EDITS)
}

function canMergeTypingEdit(previous: WriteRecentEdit, next: WriteRecentEdit): boolean {
  if (previous.source !== 'user' || next.source !== 'user') return false
  if (!pathsEqual(previous.filePath, next.filePath)) return false
  if (previous.deletedText || next.deletedText) return false
  if (!previous.insertedText || !next.insertedText) return false
  if (previous.instruction || next.instruction || previous.scopeKind || next.scopeKind) return false
  if (next.timestamp < previous.timestamp) return false
  if (next.timestamp - previous.timestamp > MERGE_TYPING_WINDOW_MS) return false

  const expectedNextFrom = previous.from + previous.insertedText.length
  return next.from >= previous.from && next.from <= expectedNextFrom + 2
}

function mergeAdjacentTypingEdits(edits: WriteRecentEdit[]): WriteRecentEdit[] {
  const merged: WriteRecentEdit[] = []
  for (const edit of edits) {
    const previous = merged[merged.length - 1]
    if (previous && canMergeTypingEdit(previous, edit)) {
      merged[merged.length - 1] = {
        ...previous,
        timestamp: edit.timestamp,
        insertedText: clipMiddle(`${previous.insertedText}${edit.insertedText}`, RECENT_EDIT_TEXT_LIMIT),
        afterContext: edit.afterContext,
        to: Math.max(previous.to, edit.to)
      }
      continue
    }
    merged.push(edit)
  }
  return merged
}

function editDistanceToScope(
  edit: Pick<WriteRecentEdit, 'from' | 'to'>,
  scope: { from: number; to: number }
): number {
  if (edit.to >= scope.from && edit.from <= scope.to) return 0
  if (edit.to < scope.from) return scope.from - edit.to
  return edit.from - scope.to
}

function recentEditScore(
  edit: WriteRecentEdit,
  scope: { from: number; to: number },
  now: number
): number {
  const ageMs = Math.max(0, now - edit.timestamp)
  const ageScore = Math.max(0, 1 - ageMs / RECENT_EDIT_TTL_MS)
  const distance = editDistanceToScope(edit, scope)
  const distanceScore = distance <= SAME_AREA_DISTANCE ? 1 - distance / SAME_AREA_DISTANCE : 0
  const sourceBoost = edit.source === 'inline-edit' ? 0.18 : 0
  return ageScore * 1.4 + distanceScore + sourceBoost
}

export function recentEditsForInlineEdit(
  edits: WriteRecentEdit[],
  options: {
    currentFilePath: string
    scope: { from: number; to: number }
    now?: number
  }
): WriteInlineEditRecentEdit[] {
  const now = options.now ?? Date.now()
  return edits
    .filter((edit) => pathsEqual(edit.filePath, options.currentFilePath))
    .filter((edit) => now - edit.timestamp <= RECENT_EDIT_TTL_MS)
    .map((edit) => ({
      edit,
      score: recentEditScore(edit, options.scope, now)
    }))
    .filter((item) => item.score > 0.12)
    .sort((a, b) => b.score - a.score || b.edit.timestamp - a.edit.timestamp)
    .slice(0, RECENT_EDIT_PROMPT_LIMIT)
    .sort((a, b) => a.edit.timestamp - b.edit.timestamp)
    .map(({ edit }) => ({
      source: edit.source,
      ageMs: Math.max(0, now - edit.timestamp),
      filePath: edit.filePath,
      from: edit.from,
      to: edit.to,
      deletedText: edit.deletedText,
      insertedText: edit.insertedText,
      beforeContext: edit.beforeContext,
      afterContext: edit.afterContext,
      instruction: edit.instruction,
      scopeKind: edit.scopeKind
    }))
}
