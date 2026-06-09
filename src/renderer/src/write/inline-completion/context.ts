import type { EditorState } from '@codemirror/state'
import type {
  InlineCompletionRequestContext
} from './types'
import type { WriteInlineCompletionEditCandidate } from '@shared/write-inline-completion'
import {
  INLINE_COMPLETION_PREFIX_WINDOW_CHARS,
  INLINE_COMPLETION_SUFFIX_WINDOW_CHARS
} from './constants'

const INLINE_COMPLETION_EDIT_CANDIDATE_MAX_CHARS = 80

function normalizeWhitespace(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function previousNonEmptyLine(state: EditorState, lineNumber: number): string {
  for (let current = lineNumber; current >= 1; current -= 1) {
    const line = state.doc.line(current)
    if (line.text.trim()) return line.text
  }
  return ''
}

function hasMarkdownStructure(text = ''): boolean {
  const trimmed = String(text || '').trimStart()
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^\[[ xX]\]\s/.test(trimmed)
}

function isParagraphBoundaryLine(text = ''): boolean {
  const trimmed = String(text || '').trim()
  return !trimmed ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^-{3,}$/.test(trimmed)
}

function isWordChar(char = ''): boolean {
  return /[\p{L}\p{N}_-]/u.test(char)
}

function lineColumnForOffset(state: EditorState, offset: number): { line: number; column: number } {
  const line = state.doc.lineAt(Math.max(0, Math.min(state.doc.length, offset)))
  return {
    line: line.number,
    column: offset - line.from + 1
  }
}

function clipTail(text = '', maxChars = 0): string {
  const source = String(text || '')
  if (!maxChars || source.length <= maxChars) return source
  return source.slice(source.length - maxChars)
}

function clipHead(text = '', maxChars = 0): string {
  const source = String(text || '')
  if (!maxChars || source.length <= maxChars) return source
  return source.slice(0, maxChars)
}

function buildEditCandidate(
  state: EditorState,
  lineNumber: number,
  head: number
): WriteInlineCompletionEditCandidate | undefined {
  if (state.doc.length === 0 || lineNumber < 1 || lineNumber > state.doc.lines) return undefined
  const currentLine = state.doc.line(lineNumber)
  if (isParagraphBoundaryLine(currentLine.text)) return undefined

  let from = Math.max(currentLine.from, Math.min(currentLine.to, head))
  let to = from
  const charBefore = from > currentLine.from ? state.sliceDoc(from - 1, from) : ''
  const charAfter = from < currentLine.to ? state.sliceDoc(from, from + 1) : ''

  if (!isWordChar(charBefore) && !isWordChar(charAfter)) {
    while (from > currentLine.from && /\s/.test(state.sliceDoc(from - 1, from))) from -= 1
    to = from
  }

  if (from > currentLine.from && isWordChar(state.sliceDoc(from - 1, from))) {
    to = from
    while (from > currentLine.from && isWordChar(state.sliceDoc(from - 1, from))) from -= 1
  } else if (from < currentLine.to && isWordChar(state.sliceDoc(from, from + 1))) {
    to = from
    while (from > currentLine.from && isWordChar(state.sliceDoc(from - 1, from))) from -= 1
  } else {
    return undefined
  }

  while (to < currentLine.to && isWordChar(state.sliceDoc(to, to + 1))) to += 1

  const original = state.sliceDoc(from, to)
  if (!normalizeWhitespace(original)) return undefined
  if (original.length > INLINE_COMPLETION_EDIT_CANDIDATE_MAX_CHARS) return undefined

  const start = lineColumnForOffset(state, from)
  const end = lineColumnForOffset(state, Math.max(from, to - 1))

  return {
    kind: 'selection',
    from,
    to,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
    original
  }
}

export function buildInlineCompletionRequestContext(
  state: EditorState,
  options: { filePath?: string; language?: string } = {}
): InlineCompletionRequestContext {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const prefix = state.sliceDoc(0, head)
  const suffix = state.sliceDoc(head, state.doc.length)
  const currentLinePrefix = state.sliceDoc(line.from, head)
  const currentLineSuffix = state.sliceDoc(head, line.to)
  const previousLineText = line.number > 1 ? state.doc.line(line.number - 1).text : ''
  const previousNonEmptyLineText = previousNonEmptyLine(state, line.number - 1)
  const nextLineText = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : ''
  const indentation = (currentLinePrefix.match(/^\s*/) || [''])[0]
  const trimmedLinePrefix = currentLinePrefix.trim()
  const trimmedLineSuffix = currentLineSuffix.trim()
  const docPreview = clipTail(prefix, 280)
  const previousStructuredLine = previousNonEmptyLineText || previousLineText
  const isAtLineEnd = currentLineSuffix.length === 0
  const previousLineTrimmed = previousStructuredLine.trimEnd()
  const previousLineEndsWithSentencePunctuation = /[.!?。！？]$/.test(previousLineTrimmed)
  const hasListContext = /^([-*+]\s|\d+\.\s|\[[ xX]\]\s)/.test(trimmedLinePrefix) ||
    /^(\s*[-*+]\s|\s*\d+\.\s|\s*\[[ xX]\]\s)/.test(previousStructuredLine)
  const hasQuoteContext = /^>\s/.test(trimmedLinePrefix) || /^\s*>\s/.test(previousStructuredLine)
  const hasHeadingContext = /^#{1,6}\s/.test(trimmedLinePrefix) || /^#{1,6}\s/.test(previousStructuredLine)
  const hasTableContext = /^\|/.test(trimmedLinePrefix) || /^\|/.test(previousStructuredLine)
  const endsWithSentencePunctuation = /[.!?。！？:：]$/.test(currentLinePrefix.trimEnd())
  const prefersNewLineCompletion =
    isAtLineEnd &&
    endsWithSentencePunctuation &&
    !hasHeadingContext &&
    !hasTableContext
  const isParagraphBreakOpportunity =
    !trimmedLinePrefix &&
    !trimmedLineSuffix &&
    previousLineEndsWithSentencePunctuation

  return {
    filePath: String(options.filePath || ''),
    language: String(options.language || 'markdown'),
    head,
    lineNumber: line.number,
    column: head - line.from,
    docLength: state.doc.length,
    prefix,
    suffix,
    prefixWindow: clipTail(prefix, INLINE_COMPLETION_PREFIX_WINDOW_CHARS),
    suffixWindow: clipHead(suffix, INLINE_COMPLETION_SUFFIX_WINDOW_CHARS),
    currentLinePrefix,
    currentLineSuffix,
    currentLineText: line.text,
    previousLineText,
    previousNonEmptyLineText,
    nextLineText,
    indentation,
    isAtLineEnd,
    currentLinePrefixTrimmed: trimmedLinePrefix,
    currentLineSuffixTrimmed: trimmedLineSuffix,
    docPreview,
    isBlankLine: !trimmedLinePrefix && !trimmedLineSuffix,
    hasMeaningfulPrefix: normalizeWhitespace(prefix).length >= 1,
    hasStructuralContext:
      hasMarkdownStructure(trimmedLinePrefix) || hasMarkdownStructure(previousStructuredLine),
    hasListContext,
    hasQuoteContext,
    hasHeadingContext,
    hasTableContext,
    endsWithWordChar: /[\p{L}\p{N}_]$/u.test(currentLinePrefix),
    endsWithSentencePunctuation,
    previousLineEndsWithSentencePunctuation,
    prefersNewLineCompletion,
    isParagraphBreakOpportunity,
    nextCharIsWord: /[\p{L}\p{N}_]/u.test(state.sliceDoc(head, Math.min(state.doc.length, head + 1))),
    looksLikeUrlTail: /https?:\/\/\S*$/i.test(currentLinePrefix),
    editCandidate: buildEditCandidate(state, line.number, head)
  }
}
