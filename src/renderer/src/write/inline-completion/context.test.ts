import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildInlineCompletionRequestContext } from './context'

function stateAt(doc: string, needle: string): EditorState {
  const head = doc.indexOf(needle) + needle.length
  if (head < needle.length) throw new Error(`Missing needle: ${needle}`)
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(head)
  })
}

describe('buildInlineCompletionRequestContext', () => {
  it('uses a local word edit candidate instead of the whole paragraph', () => {
    const doc = [
      '# Draft',
      '',
      'Hi! Let me introduce a new feature in DeepSeek gui. It includes text completion and writing tools.'
    ].join('\n')

    const context = buildInlineCompletionRequestContext(
      stateAt(doc, 'DeepSeek gui'),
      { filePath: '/tmp/workspace/draft.md' }
    )

    const candidate = context.editCandidate
    expect(candidate).toMatchObject({
      kind: 'selection',
      original: 'gui',
      startLine: 3,
      endLine: 3
    })
    expect(candidate ? candidate.to - candidate.from : 0).toBe(3)
  })

  it('uses the previous word when the cursor has advanced past trailing whitespace', () => {
    const doc = 'DeepSeek tui can write papers '

    const context = buildInlineCompletionRequestContext(
      stateAt(doc, 'DeepSeek tui can write papers '),
      { filePath: '/tmp/workspace/draft.md' }
    )

    expect(context.editCandidate?.original).toBe('papers')
  })
})
