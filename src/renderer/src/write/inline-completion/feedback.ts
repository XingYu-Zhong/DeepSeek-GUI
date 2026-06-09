import {
  INLINE_COMPLETION_MAX_VISIBLE_CHARS,
  INLINE_COMPLETION_MAX_VISIBLE_LINES,
  INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  INLINE_LONG_COMPLETION_MAX_VISIBLE_CHARS,
  INLINE_LONG_COMPLETION_MAX_VISIBLE_LINES,
  INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE
} from './constants'
import type {
  InlineCompletionFeedback,
  InlineCompletionRequestContext,
  InlineCompletionSuggestion
} from './types'
import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionMode
} from '@shared/write-inline-completion'

function sanitizeText(text = ''): string {
  return String(text || '').replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '')
}

function compactText(text = ''): string {
  return sanitizeText(text).replace(/\s+/g, ' ').trim()
}

function clipPreview(text = '', maxChars = 100): string {
  const normalized = compactText(text)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function actionText(action: WriteInlineCompletionAction): string {
  return action.kind === 'edit' ? action.replacement : action.text
}

function actionFromSuggestion(
  suggestion: InlineCompletionSuggestion | string | null,
  fallbackMode: WriteInlineCompletionMode
): WriteInlineCompletionAction | null {
  const completionKind = fallbackMode === 'long' ? 'long' : 'short'
  if (typeof suggestion === 'string') return { kind: completionKind, text: suggestion }
  if (suggestion?.action) return suggestion.action
  if (suggestion?.text) return { kind: completionKind, text: suggestion.text }
  return null
}

function hasStructuredModelAction(suggestion: InlineCompletionSuggestion | string | null): boolean {
  return typeof suggestion !== 'string' && Boolean(suggestion?.action)
}

function usefulSingleToken(text = '', context: InlineCompletionRequestContext): boolean {
  const value = sanitizeText(text)
  if (value.length !== 1) return false
  if (/^[)\]}>:.,]$/.test(value)) return true
  if (value === '\n' && (context.hasListContext || context.endsWithSentencePunctuation)) return true
  return false
}

function structuralBoost(context: InlineCompletionRequestContext, text: string): number {
  let score = 0
  if (context.hasStructuralContext && !/^\n{3,}/.test(text)) score += 0.12
  if (context.hasListContext && !/^\n{2,}/.test(text)) score += 0.1
  if (
    context.hasQuoteContext &&
    (!text.trimStart() || text.trimStart().startsWith('>') || text.startsWith('\n'))
  ) {
    score += 0.08
  }
  if (context.indentation && (text.startsWith(context.indentation) || text.startsWith('\n'))) {
    score += 0.08
  }
  return score
}

function continuityBoost(context: InlineCompletionRequestContext, text: string): number {
  let score = 0
  const trimmed = text.trimStart()
  if (context.endsWithWordChar && /^[\p{L}\p{N}_'"-]/u.test(trimmed)) score += 0.2
  if (!context.endsWithWordChar && /^[\s,.;:!?)}\]]/.test(text)) score += 0.08
  if (context.endsWithSentencePunctuation && /^\s*\n/.test(text)) score += 0.12
  return score
}

function redundancyPenalty(context: InlineCompletionRequestContext, text: string): number {
  const normalized = compactText(text)
  if (!normalized) return 1
  const suffixHead = compactText(
    String(context.suffixWindow || '').slice(0, Math.max(normalized.length + 12, 40))
  )
  if (normalized.length >= 3 && suffixHead.startsWith(normalized)) return 1
  const prefixTail = compactText(
    String(context.prefixWindow || '').slice(-Math.max(normalized.length + 24, 80))
  )
  if (normalized.length >= 5 && prefixTail.endsWith(normalized)) return 0.45
  return 0
}

function genericPenalty(context: InlineCompletionRequestContext, text: string): number {
  const trimmed = compactText(text).toLowerCase()
  if (!trimmed) return 0.4
  const startsWithGenericLead =
    /^(the|this|that|it|they|there|here|we|you|然后|这里|这个|这个时候)/.test(trimmed)
  if (startsWithGenericLead && !context.hasStructuralContext && !context.endsWithWordChar) {
    return 0.18
  }
  if (trimmed.length <= 2 && !usefulSingleToken(text, context)) return 0.22
  return 0
}

function lengthPenalty(text = '', mode: WriteInlineCompletionMode = 'short'): number {
  const charCount = sanitizeText(text).length
  const lineCount = sanitizeText(text).split('\n').length
  if (mode === 'long') {
    if (charCount > 760 || lineCount > 10) return 0.08
    return 0
  }
  if (charCount > 140 || lineCount > 3) return 0.14
  return 0
}

function sentenceBoundaryPenalty(context: InlineCompletionRequestContext, text = ''): number {
  if (!context.prefersNewLineCompletion) return 0
  const source = sanitizeText(text)
  if (!source) return 0
  if (/^\n/.test(source)) return -0.12
  if (usefulSingleToken(source, context)) return 0
  if (/^[ \t]*[\p{L}\p{N}"'“‘(]/u.test(source)) return 0.42
  return 0.08
}

function paragraphStartBoost(context: InlineCompletionRequestContext, text = ''): number {
  if (!context.isParagraphBreakOpportunity) return 0
  const source = sanitizeText(text)
  if (!source) return 0
  if (/^[\p{L}\p{N}"'“‘(]/u.test(source)) return 0.22
  return 0
}

function reject(
  reason: string,
  context: InlineCompletionRequestContext,
  text = '',
  score = 0,
  mode: WriteInlineCompletionMode = 'short'
): {
  accepted: false
  text: ''
  feedback: InlineCompletionFeedback
} {
  return {
    accepted: false,
    text: '',
    feedback: {
      phase: 'candidate',
      decision: 'suppress',
      reason,
      score,
      preview: clipPreview(text),
      mode,
      cursor: {
        line: context.lineNumber,
        column: context.column
      }
    }
  }
}

export function evaluateInlineCompletionCandidate(
  context: InlineCompletionRequestContext,
  suggestion: InlineCompletionSuggestion | string | null,
  options: {
    minAcceptScore?: number
    longMinAcceptScore?: number
    mode?: WriteInlineCompletionMode
  } = {}
): {
  accepted: boolean
  text: string
  action?: WriteInlineCompletionAction
  feedback: InlineCompletionFeedback
} {
  const requestedMode = options.mode ?? (typeof suggestion === 'string' ? 'short' : suggestion?.mode) ?? 'short'
  const rawAction = actionFromSuggestion(suggestion, requestedMode)
  const isEditAction = rawAction?.kind === 'edit'
  const structuredModelAction = hasStructuredModelAction(suggestion)
  const text = sanitizeText(rawAction ? actionText(rawAction) : '')
  const mode = rawAction?.kind ?? requestedMode
  const minAcceptScore = Number.isFinite(options.minAcceptScore)
    ? Number(options.minAcceptScore)
    : mode === 'long'
      ? INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE
      : INLINE_COMPLETION_MIN_ACCEPT_SCORE
  const effectiveMinAcceptScore = mode === 'long' && Number.isFinite(options.longMinAcceptScore)
    ? Number(options.longMinAcceptScore)
    : minAcceptScore
  if (!text) return reject('empty-candidate', context, text, 0, mode)
  if (!compactText(text) && !usefulSingleToken(text, context)) {
    return reject('blank-candidate', context, text, 0, mode)
  }

  if (isEditAction) {
    const action = rawAction
    const original = sanitizeText(action.original)
    if (action.from < 0 || action.to < action.from) {
      return reject('invalid-edit-range', context, text, 0.05, mode)
    }
    if (compactText(original) === compactText(text)) {
      return reject('unchanged-edit', context, text, 0.08, mode)
    }

    const charCount = text.length
    const lineCount = text.split('\n').length
    if (charCount > INLINE_LONG_COMPLETION_MAX_VISIBLE_CHARS) {
      return reject('edit-too-long', context, text, 0.08, mode)
    }
    if (lineCount > INLINE_LONG_COMPLETION_MAX_VISIBLE_LINES) {
      return reject('edit-too-many-lines', context, text, 0.08, mode)
    }

    const score = mode === 'long' ? 0.64 : 0.58
    if (score < effectiveMinAcceptScore) {
      return reject('low-confidence', context, text, score, mode)
    }

    return {
      accepted: true,
      text,
      action: {
        ...action,
        replacement: text
      },
      feedback: {
        phase: 'candidate',
        decision: 'show',
        reason: 'model-selected-edit',
        score,
        preview: clipPreview(text),
        mode,
        cursor: {
          line: context.lineNumber,
          column: context.column
        }
      }
    }
  }

  const charCount = text.length
  const lineCount = text.split('\n').length
  const maxVisibleChars = mode === 'long'
    ? INLINE_LONG_COMPLETION_MAX_VISIBLE_CHARS
    : INLINE_COMPLETION_MAX_VISIBLE_CHARS
  const maxVisibleLines = mode === 'long'
    ? INLINE_LONG_COMPLETION_MAX_VISIBLE_LINES
    : INLINE_COMPLETION_MAX_VISIBLE_LINES
  if (charCount > maxVisibleChars) {
    return reject('too-long', context, text, 0.08, mode)
  }
  if (lineCount > maxVisibleLines) {
    return reject('too-many-lines', context, text, 0.08, mode)
  }

  const duplicatePenalty = redundancyPenalty(context, text)
  if (duplicatePenalty >= 1) {
    return reject('already-in-suffix', context, text, 0.05, mode)
  }

  const boundaryPenalty = sentenceBoundaryPenalty(context, text)
  if (boundaryPenalty >= 0.4) {
    return reject('sentence-boundary', context, text, 0.04, mode)
  }

  let score = mode === 'long'
    ? (structuredModelAction ? 0.48 : 0.4)
    : (structuredModelAction ? 0.58 : 0.34)
  score += continuityBoost(context, text)
  score += structuralBoost(context, text)
  score += paragraphStartBoost(context, text)
  score -= duplicatePenalty
  score -= boundaryPenalty
  score -= genericPenalty(context, text)
  score -= lengthPenalty(text, mode)

  if (score < effectiveMinAcceptScore) {
    return reject('low-confidence', context, text, Number(score.toFixed(2)), mode)
  }

  return {
    accepted: true,
    text,
    action: { kind: mode === 'long' ? 'long' : 'short', text },
    feedback: {
      phase: 'candidate',
      decision: 'show',
      reason: structuredModelAction ? 'model-returned-action' : 'high-confidence',
      score: Number(score.toFixed(2)),
      preview: clipPreview(text),
      mode,
      cursor: {
        line: context.lineNumber,
        column: context.column
      }
    }
  }
}
