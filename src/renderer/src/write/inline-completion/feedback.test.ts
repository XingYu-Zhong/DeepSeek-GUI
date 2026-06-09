import { describe, expect, it } from 'vitest'
import type { InlineCompletionRequestContext } from './types'
import { evaluateInlineCompletionCandidate } from './feedback'

function context(partial: Partial<InlineCompletionRequestContext> = {}): InlineCompletionRequestContext {
  return {
    filePath: '/tmp/workspace/draft.md',
    language: 'markdown',
    head: 12,
    lineNumber: 1,
    column: 12,
    docLength: 48,
    prefix: 'This is ',
    suffix: ' a draft.',
    prefixWindow: 'This is ',
    suffixWindow: ' a draft.',
    currentLinePrefix: 'This is ',
    currentLineSuffix: ' a draft.',
    currentLineText: 'This is  a draft.',
    previousLineText: '',
    previousNonEmptyLineText: '',
    nextLineText: '',
    indentation: '',
    isAtLineEnd: false,
    currentLinePrefixTrimmed: 'This is',
    currentLineSuffixTrimmed: 'a draft.',
    docPreview: 'This is ',
    isBlankLine: false,
    hasMeaningfulPrefix: true,
    hasStructuralContext: false,
    hasListContext: false,
    hasQuoteContext: false,
    hasHeadingContext: false,
    hasTableContext: false,
    endsWithWordChar: false,
    endsWithSentencePunctuation: false,
    previousLineEndsWithSentencePunctuation: false,
    prefersNewLineCompletion: false,
    isParagraphBreakOpportunity: false,
    nextCharIsWord: false,
    looksLikeUrlTail: false,
    ...partial
  }
}

describe('evaluateInlineCompletionCandidate', () => {
  it('shows structured short actions that pass hard local checks', () => {
    const decision = evaluateInlineCompletionCandidate(
      context(),
      {
        text: 'a focused continuation',
        action: { kind: 'short', text: 'a focused continuation' }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(true)
    expect(decision.feedback.reason).toBe('model-returned-action')
  })

  it('still suppresses structured actions that duplicate the suffix', () => {
    const decision = evaluateInlineCompletionCandidate(
      context({ suffixWindow: 'a focused continuation after the cursor' }),
      {
        text: 'a focused continuation',
        action: { kind: 'short', text: 'a focused continuation' }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(false)
    expect(decision.feedback.reason).toBe('already-in-suffix')
  })

  it('accepts structured edit actions for unchanged local hard checks', () => {
    const decision = evaluateInlineCompletionCandidate(
      context(),
      {
        text: 'Write mode keeps text editing local.',
        action: {
          kind: 'edit',
          from: 0,
          to: 41,
          original: 'DeepSeek GUI keeps text editing local.',
          replacement: 'Write mode keeps text editing local.',
          scopeKind: 'paragraph'
        }
      },
      { minAcceptScore: 0.52, mode: 'short' }
    )

    expect(decision.accepted).toBe(true)
    expect(decision.action).toMatchObject({
      kind: 'edit',
      replacement: 'Write mode keeps text editing local.'
    })
    expect(decision.feedback.reason).toBe('model-selected-edit')
  })
})
