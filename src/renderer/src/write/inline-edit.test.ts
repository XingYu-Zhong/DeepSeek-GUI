import { describe, expect, it } from 'vitest'
import type { WriteSelectionRange } from '../components/write/WriteMarkdownEditor'
import {
  applyWriteInlineEditReplacement,
  buildWriteInlineEditCompletionRequest,
  buildWriteInlineEditDraft,
  resolveWriteInlineEditScope
} from './inline-edit'

function selectionRange(content: string, selected: string): WriteSelectionRange {
  const from = content.indexOf(selected)
  if (from < 0) throw new Error(`Missing selected text: ${selected}`)
  const to = from + selected.length
  return {
    from,
    to,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: selected.length,
    text: selected,
    charCount: selected.length
  }
}

describe('write inline edit helpers', () => {
  it('keeps a short selected phrase as the exact edit scope', () => {
    const content = [
      '# Draft',
      '',
      'Alpha is the product name. Alpha helps writers keep terminology aligned.',
      '',
      'Next paragraph.'
    ].join('\n')
    const range = selectionRange(content, 'Alpha helps')

    const scope = resolveWriteInlineEditScope(content, range)

    expect(scope.kind).toBe('selection')
    expect(scope.startLine).toBe(3)
    expect(scope.endLine).toBe(3)
    expect(scope.text).toBe('Alpha helps')
    expect(scope.selectedText).toBe('Alpha helps')
  })

  it('builds an edit payload around the exact selected scope', () => {
    const content = [
      '# Draft',
      '',
      'Alpha is the product name. Alpha helps writers keep terminology aligned.',
      '',
      'Next paragraph.'
    ].join('\n')
    const range = selectionRange(content, 'Alpha helps')

    const draft = buildWriteInlineEditDraft(content, range, 'Rename Alpha to Write mode.', {
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/draft.md',
      model: 'deepseek-v4-flash'
    })

    expect(draft.request.prefix).toBe('# Draft\n\nAlpha is the product name. ')
    expect(draft.request.suffix).toBe(' writers keep terminology aligned.\n\nNext paragraph.')
    expect(draft.request.original).toBe(draft.scope.text)
    expect(draft.request.context.selectedText).toBe('Alpha helps')
    expect(draft.request.scope.kind).toBe('selection')
  })

  it('converts explicit inline edits into completion mode edit requests', () => {
    const content = [
      '# Draft',
      '',
      'Alpha is the product name. Alpha helps writers keep terminology aligned.'
    ].join('\n')
    const draft = buildWriteInlineEditDraft(content, selectionRange(content, 'Alpha helps'), 'Rename Alpha to Write mode.', {
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/draft.md',
      model: 'deepseek-v4-flash'
    })

    const request = buildWriteInlineEditCompletionRequest(draft.request)

    expect(request.mode).toBe('edit')
    expect(request.editCandidate).toMatchObject({
      kind: 'selection',
      original: draft.scope.text,
      selectedText: 'Alpha helps'
    })
    expect(request.policy.instruction).toContain('Rename Alpha to Write mode.')
    expect(request.prefix).toBe(draft.request.prefix)
    expect(request.suffix).toBe(draft.request.suffix)
  })

  it('adds recent same-file edits to the inline edit payload', () => {
    const content = [
      '# Draft',
      '',
      'Alpha is the product name. Alpha helps writers keep terminology aligned.'
    ].join('\n')
    const range = selectionRange(content, 'Alpha helps')
    const now = Date.parse('2026-05-27T00:00:10.000Z')

    const draft = buildWriteInlineEditDraft(content, range, 'Continue the same rename.', {
      currentFilePath: '/tmp/workspace/draft.md',
      now,
      recentEdits: [{
        id: 'edit-1',
        source: 'user',
        timestamp: now - 1_500,
        filePath: '/tmp/workspace/draft.md',
        from: 10,
        to: 15,
        deletedText: 'Beta',
        insertedText: 'Alpha',
        beforeContext: 'Rename ',
        afterContext: ' consistently.'
      }]
    })

    expect(draft.request.recentEdits).toHaveLength(1)
    expect(draft.request.recentEdits?.[0]).toMatchObject({
      ageMs: 1_500,
      deletedText: 'Beta',
      insertedText: 'Alpha'
    })
  })

  it('does not pull surrounding paragraph text into a selection edit', () => {
    const content = [
      '## Product',
      'Alpha is the product name. Alpha helps writers.',
      '',
      'Next paragraph.'
    ].join('\n')
    const range = selectionRange(content, 'Alpha helps')

    const scope = resolveWriteInlineEditScope(content, range)

    expect(scope.kind).toBe('selection')
    expect(scope.startLine).toBe(2)
    expect(scope.text).toBe('Alpha helps')
  })

  it('applies replacement only to the resolved scope', () => {
    const content = [
      '# Draft',
      '',
      'Alpha is the product name. Alpha helps writers keep terminology aligned.',
      '',
      'Next paragraph.'
    ].join('\n')
    const draft = buildWriteInlineEditDraft(
      content,
      selectionRange(content, 'Alpha helps'),
      'Rename Alpha to Write mode.'
    )

    const next = applyWriteInlineEditReplacement(
      content,
      draft.scope,
      'Write mode helps'
    )

    expect(next).toBe([
      '# Draft',
      '',
      'Alpha is the product name. Write mode helps writers keep terminology aligned.',
      '',
      'Next paragraph.'
    ].join('\n'))
  })
})
