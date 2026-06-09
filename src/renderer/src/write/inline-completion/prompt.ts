import type {
  InlineCompletionPayload,
  InlineCompletionRequestContext
} from './types'
import type {
  WriteInlineCompletionEditCandidate,
  WriteInlineCompletionMode
} from '@shared/write-inline-completion'
import { recentEditsForInlineEdit, type WriteRecentEdit } from '../recent-edits'

const INLINE_EDIT_PHRASE_CANDIDATE_MAX_CHARS = 80

type InlineRewriteSignalEdit = Pick<
  WriteRecentEdit,
  'source' | 'instruction' | 'scopeKind' | 'deletedText' | 'insertedText'
>

function compactText(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(text = ''): string {
  return String(text || '').toLocaleLowerCase()
}

function isWordChar(char = ''): boolean {
  return /[\p{L}\p{N}_-]/u.test(char)
}

function hasTermBoundary(line: string, from: number, to: number): boolean {
  const before = from > 0 ? line.slice(from - 1, from) : ''
  const after = to < line.length ? line.slice(to, to + 1) : ''
  return (!before || !isWordChar(before)) && (!after || !isWordChar(after))
}

function recentEditSuggestsInlineRewrite(
  edit: Omit<InlineRewriteSignalEdit, 'insertedText'>
): boolean {
  if (edit.source === 'inline-edit') return true
  if (edit.instruction?.trim()) return true
  if (edit.scopeKind) return true
  if (compactText(edit.deletedText).length > 0) return true
  return false
}

function recentEditTerms(edits: InlineRewriteSignalEdit[] = []): string[] {
  const terms = new Set<string>()
  for (const edit of edits) {
    if (!recentEditSuggestsInlineRewrite(edit)) continue
    for (const raw of [edit.deletedText, edit.insertedText]) {
      const term = raw.replace(/\r\n?/g, '\n').trim()
      if (!term || term.length > INLINE_EDIT_PHRASE_CANDIDATE_MAX_CHARS) continue
      if (term.includes('\n')) continue
      if (!/[\p{L}\p{N}]/u.test(term)) continue
      terms.add(term)
    }
  }
  return [...terms].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

function editHasExplicitRewriteIntent(
  edit: Pick<InlineRewriteSignalEdit, 'source' | 'instruction' | 'scopeKind'>
): boolean {
  return edit.source === 'inline-edit' || Boolean(edit.instruction?.trim()) || Boolean(edit.scopeKind)
}

function candidateMatchesRecentEditTerm(
  candidate: WriteInlineCompletionEditCandidate | undefined,
  edits: InlineRewriteSignalEdit[] | undefined
): boolean {
  if (!candidate || !edits?.length) return false
  const candidateTerm = normalizeForMatch(compactText(candidate.original))
  if (!candidateTerm) return false
  return recentEditTerms(edits).some((term) => normalizeForMatch(compactText(term)) === candidateTerm)
}

function phraseCandidateFromRecentEdits(
  context: InlineCompletionRequestContext,
  edits: WriteRecentEdit[] | undefined
): WriteInlineCompletionEditCandidate | undefined {
  const base = context.editCandidate
  if (!base || !edits?.length) return base
  const line = context.currentLineText
  if (!line.trim()) return base

  const lineFrom = context.head - context.currentLinePrefix.length
  const normalizedLine = normalizeForMatch(line)
  for (const term of recentEditTerms(edits)) {
    if (term.length <= base.original.length) continue
    const normalizedTerm = normalizeForMatch(term)
    let index = normalizedLine.indexOf(normalizedTerm)
    while (index >= 0) {
      const from = lineFrom + index
      const to = from + term.length
      const overlapsBase = from < base.to && base.from < to
      const containsCursor = from <= context.head && context.head <= to
      if (
        (overlapsBase || containsCursor) &&
        hasTermBoundary(line, index, index + term.length)
      ) {
        return {
          kind: 'selection',
          from,
          to,
          startLine: context.lineNumber,
          startColumn: index + 1,
          endLine: context.lineNumber,
          endColumn: index + term.length,
          original: line.slice(index, index + term.length)
        }
      }
      index = normalizedLine.indexOf(normalizedTerm, index + 1)
    }
  }
  return base
}

function contextNotes(context: InlineCompletionRequestContext): string[] {
  const notes: string[] = []
  if (context.hasListContext) {
    notes.push('Continue the current list item or next bullet only if the local markdown structure clearly suggests it.')
  }
  if (context.hasQuoteContext) notes.push('Preserve the current blockquote marker and indentation.')
  if (context.hasHeadingContext) {
    notes.push('Prefer a short heading continuation instead of drafting a new section.')
  }
  if (context.hasTableContext) notes.push('Respect table cell boundaries and pipe separators.')
  if (context.prefersNewLineCompletion) {
    notes.push('The current sentence looks complete at the end of the line. Do not tack extra words onto that line; wait for a new line instead.')
  }
  if (context.isParagraphBreakOpportunity) {
    notes.push('The cursor is on a fresh paragraph break after a completed sentence. Suggest the opening of the next paragraph only if the nearby context strongly supports it.')
  }
  if (context.endsWithSentencePunctuation && !context.prefersNewLineCompletion) {
    notes.push('A short continuation or newline is more likely than a long new paragraph.')
  }
  return notes
}

export function buildInlineCompletionPayload(
  context: InlineCompletionRequestContext,
  options: {
    model?: string
    workspaceRoot?: string
    mode?: WriteInlineCompletionMode
    recentEdits?: WriteRecentEdit[]
    now?: number
  } = {}
): InlineCompletionPayload {
  const mode = options.mode ?? 'short'
  const candidate = phraseCandidateFromRecentEdits(context, options.recentEdits)
  const scopedRecentEdits = candidate && options.recentEdits
    ? recentEditsForInlineEdit(options.recentEdits, {
        currentFilePath: context.filePath,
        scope: candidate,
        now: options.now
      })
    : undefined
  const hasInlineRewriteSignal = Boolean(
    scopedRecentEdits?.some(editHasExplicitRewriteIntent) ||
    candidateMatchesRecentEditTerm(candidate, scopedRecentEdits)
  )
  const recentEdits = hasInlineRewriteSignal ? scopedRecentEdits : undefined
  const editCandidate = hasInlineRewriteSignal ? candidate : undefined
  const notes = contextNotes(context)
  const editInstructions = editCandidate
    ? [
        'A small local editable scope is available because the user recently changed existing text in this area.',
        'You may return <<<EDIT ... >>> with replacement text for that exact small scope when replacing the scope is more helpful than inserting at the cursor.',
        'Do not use <<<EDIT ... >>> to rewrite, summarize, or collapse an entire sentence or paragraph when the scope is only a word or short phrase.',
        'Choose <<<SHORT ... >>> or <<<LONG ... >>> when the user is simply continuing from the cursor.'
      ]
    : []
  const longInstructions = mode === 'long'
    ? [
        'The user has paused for inspiration. You may suggest a richer continuation, but keep it directly grounded in the existing draft.',
        'Prefer one compact paragraph or a short list continuation. Do not produce a full article, outline, or generic brainstorm.',
        'Use retrieved references as style and terminology hints when they fit the current passage.'
      ]
    : []
  const policy = {
    name: mode === 'long' ? 'inspiration-inline-v1' : 'precision-inline-v2',
    instruction: [
      'Return exactly one TextIDE-style marked action block for the current writing moment.',
      'For <<<SHORT ... >>> and <<<LONG ... >>>, return only text that should be inserted at the cursor.',
      'For <<<EDIT ... >>>, return only the replacement text for the editable scope.',
      'Prefer returning an empty completion when the local context is ambiguous.',
      'Do not repeat text that already exists after the cursor.',
      'Treat this as inline editing plus completion, not open-ended writing.',
      'Keep completions short, local, and structurally aligned with the current markdown block.',
      'Do not invent new sections, summaries, or generic filler when the nearby context does not justify them.',
      ...editInstructions,
      ...longInstructions,
      ...notes
    ].join('\n'),
    acceptanceCriteria: [
      'The returned action should be locally useful for this exact cursor position.',
      'Completion actions should look like the most likely next keystrokes for this exact cursor position.',
      'Edit actions should improve the provided editable scope without adding unchanged surrounding text.',
      'The action should preserve indentation, markdown markers, and local phrasing.',
      ...(mode === 'long'
        ? ['The completion may provide a useful next thought without taking over the whole draft.']
        : []),
      'The completion should be safe to hide completely if confidence is low.'
    ],
    rejectionCriteria: [
      'Skip completions that only restate earlier text.',
      'Skip completions that open a new topic not grounded in the current block.',
      'Skip completions that are long, generic, or speculative.'
    ]
  }

  return {
    prefix: context.prefixWindow,
    suffix: context.suffixWindow,
    mode,
    workspaceRoot: options.workspaceRoot,
    currentFilePath: context.filePath,
    cursor: {
      line: context.lineNumber,
      column: context.column
    },
    context: {
      language: context.language,
      currentLinePrefix: context.currentLinePrefix,
      currentLineSuffix: context.currentLineSuffix,
      previousLine: context.previousLineText,
      previousNonEmptyLine: context.previousNonEmptyLineText,
      nextLine: context.nextLineText,
      indentation: context.indentation,
      signals: {
        list: context.hasListContext,
        quote: context.hasQuoteContext,
        heading: context.hasHeadingContext,
        table: context.hasTableContext,
        atLineEnd: context.isAtLineEnd,
        endsWithSentencePunctuation: context.endsWithSentencePunctuation,
        previousLineEndsWithSentencePunctuation: context.previousLineEndsWithSentencePunctuation,
        prefersNewLineCompletion: context.prefersNewLineCompletion,
        paragraphBreakOpportunity: context.isParagraphBreakOpportunity
      }
    },
    policy,
    preview: {
      local: compactText(context.currentLineText).slice(0, 120),
      documentTail: compactText(context.docPreview).slice(0, 180)
    },
    editCandidate,
    recentEdits: recentEdits?.length ? recentEdits : undefined,
    model: options.model
  }
}
