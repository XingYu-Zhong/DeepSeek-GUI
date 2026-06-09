import { describe, expect, it } from 'vitest'
import type { InlineCompletionRequestContext } from './types'
import { buildInlineCompletionPayload } from './prompt'
import type { WriteRecentEdit } from '../recent-edits'

const now = Date.parse('2026-05-27T00:00:10.000Z')

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
    editCandidate: {
      kind: 'selection',
      from: 15,
      to: 19,
      startLine: 3,
      startColumn: 7,
      endLine: 3,
      endColumn: 10,
      original: 'mode'
    },
    ...partial
  }
}

function edit(partial: Partial<WriteRecentEdit>): WriteRecentEdit {
  return {
    id: 'edit-1',
    source: 'user',
    timestamp: now - 1_000,
    filePath: '/tmp/workspace/draft.md',
    from: 9,
    to: 9,
    deletedText: '',
    insertedText: 'Write mode',
    beforeContext: '',
    afterContext: ' keeps terminology aligned.',
    ...partial
  }
}

describe('buildInlineCompletionPayload', () => {
  it('does not arm edit mode for ordinary typing insertions', () => {
    const payload = buildInlineCompletionPayload(context(), {
      now,
      recentEdits: [edit({ insertedText: 'Write mode' })]
    })

    expect(payload.editCandidate).toBeUndefined()
    expect(payload.recentEdits).toBeUndefined()
    expect(payload.policy.instruction).toContain('Return exactly one TextIDE-style marked action block')
  })

  it('arms the unified edit path after a same-scope replacement', () => {
    const payload = buildInlineCompletionPayload(context(), {
      now,
      recentEdits: [edit({
        from: 9,
        to: 21,
        deletedText: 'DeepSeek GUI',
        insertedText: 'Write mode'
      })]
    })

    expect(payload.editCandidate?.original).toBe('Write mode')
    expect(payload.recentEdits).toHaveLength(1)
    expect(payload.policy.instruction).toContain('You may return <<<EDIT')
  })

  it('does not arm edit mode for unrelated words near a replacement', () => {
    const payload = buildInlineCompletionPayload(
      context({
        head: 19,
        prefix: '# Draft\n\nQuiet mode',
        prefixWindow: '# Draft\n\nQuiet mode',
        currentLinePrefix: 'Quiet mode',
        currentLineText: 'Quiet mode keeps terminology aligned.',
        currentLinePrefixTrimmed: 'Quiet mode',
        docPreview: '# Draft\n\nQuiet mode'
      }),
      {
        now,
        recentEdits: [edit({
          from: 9,
          to: 21,
          deletedText: 'DeepSeek GUI',
          insertedText: 'Write mode'
        })]
      }
    )

    expect(payload.editCandidate).toBeUndefined()
    expect(payload.recentEdits).toBeUndefined()
  })

  it('expands a local word candidate to a nearby term from recent replacements', () => {
    const payload = buildInlineCompletionPayload(
      context({
        head: 29,
        column: 21,
        prefix: '# Draft\n\nAnother DeepSeek gui',
        suffix: ' mention needs alignment.',
        prefixWindow: '# Draft\n\nAnother DeepSeek gui',
        suffixWindow: ' mention needs alignment.',
        currentLinePrefix: 'Another DeepSeek gui',
        currentLineSuffix: ' mention needs alignment.',
        currentLineText: 'Another DeepSeek gui mention needs alignment.',
        currentLinePrefixTrimmed: 'Another DeepSeek gui',
        currentLineSuffixTrimmed: 'mention needs alignment.',
        docPreview: '# Draft\n\nAnother DeepSeek gui',
        editCandidate: {
          kind: 'selection',
          from: 26,
          to: 29,
          startLine: 3,
          startColumn: 18,
          endLine: 3,
          endColumn: 20,
          original: 'gui'
        }
      }),
      {
        now,
        recentEdits: [edit({
          from: 9,
          to: 21,
          deletedText: 'DeepSeek GUI',
          insertedText: 'Write mode'
        })]
      }
    )

    expect(payload.editCandidate).toMatchObject({
      kind: 'selection',
      original: 'DeepSeek gui'
    })
    expect(payload.editCandidate ? payload.editCandidate.to - payload.editCandidate.from : 0).toBe(12)
  })
})
