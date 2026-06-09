import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { InlineCompletionRequestContext } from './types'
import {
  inlineCompletionMinRequestInterval,
  inlineCompletionRequestSignature,
  inlineEditReplacementAnchor,
  isInlineCompletionEmptyFeedback
} from './codemirror'

describe('inline edit CodeMirror placement', () => {
  it('anchors single-line replacements after the edited text', () => {
    const state = EditorState.create({ doc: 'Alpha helps writers.' })

    expect(inlineEditReplacementAnchor(state, {
      kind: 'edit',
      from: 0,
      to: 5,
      original: 'Alpha',
      replacement: 'Write mode',
      scopeKind: 'selection'
    })).toEqual({
      position: 5,
      leading: false
    })
  })

  it('anchors multi-line replacements at the start of the edited scope', () => {
    const state = EditorState.create({
      doc: 'First paragraph line one\nline two\n\nNext paragraph'
    })

    expect(inlineEditReplacementAnchor(state, {
      kind: 'edit',
      from: 0,
      to: 'First paragraph line one\nline two'.length,
      original: 'First paragraph line one\nline two',
      replacement: 'Shorter paragraph',
      scopeKind: 'selection'
    })).toEqual({
      position: 0,
      leading: true
    })
  })
})

function context(partial: Partial<InlineCompletionRequestContext> = {}): InlineCompletionRequestContext {
  return {
    filePath: '/tmp/workspace/draft.md',
    language: 'markdown',
    head: 19,
    lineNumber: 3,
    column: 11,
    docLength: 46,
    prefix: '# Draft\n\nWrite mode',
    suffix: ' keeps terminology aligned.',
    prefixWindow: '# Draft\n\nWrite mode',
    suffixWindow: ' keeps terminology aligned.',
    currentLinePrefix: 'Write mode',
    currentLineSuffix: ' keeps terminology aligned.',
    currentLineText: 'Write mode keeps terminology aligned.',
    previousLineText: '',
    previousNonEmptyLineText: '# Draft',
    nextLineText: '',
    indentation: '',
    isAtLineEnd: false,
    currentLinePrefixTrimmed: 'Write mode',
    currentLineSuffixTrimmed: 'keeps terminology aligned.',
    docPreview: '# Draft\n\nWrite mode',
    isBlankLine: false,
    hasMeaningfulPrefix: true,
    hasStructuralContext: false,
    hasListContext: false,
    hasQuoteContext: false,
    hasHeadingContext: false,
    hasTableContext: false,
    endsWithWordChar: true,
    endsWithSentencePunctuation: false,
    previousLineEndsWithSentencePunctuation: false,
    prefersNewLineCompletion: false,
    isParagraphBreakOpportunity: false,
    nextCharIsWord: false,
    looksLikeUrlTail: false,
    ...partial
  }
}

describe('inline completion request pacing helpers', () => {
  it('builds a stable signature for identical local request context', () => {
    expect(inlineCompletionRequestSignature(context(), 'short')).toBe(
      inlineCompletionRequestSignature(context(), 'short')
    )
    expect(inlineCompletionRequestSignature(context(), 'short')).not.toBe(
      inlineCompletionRequestSignature(context({ head: 20, currentLinePrefix: 'Write mode ' }), 'short')
    )
  })

  it('uses a longer request interval for long completion', () => {
    expect(inlineCompletionMinRequestInterval('long')).toBeGreaterThan(
      inlineCompletionMinRequestInterval('short')
    )
  })

  it('classifies empty model results for cooldown', () => {
    expect(isInlineCompletionEmptyFeedback('empty-candidate')).toBe(true)
    expect(isInlineCompletionEmptyFeedback('blank-candidate')).toBe(true)
    expect(isInlineCompletionEmptyFeedback('low-confidence')).toBe(false)
  })
})
