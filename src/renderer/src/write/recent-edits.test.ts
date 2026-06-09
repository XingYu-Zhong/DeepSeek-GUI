import { describe, expect, it, vi } from 'vitest'
import {
  createWriteRecentEdit,
  recentEditsForInlineEdit,
  trimWriteRecentEdits,
  type WriteRecentEdit
} from './recent-edits'

describe('write recent edits', () => {
  it('keeps recent same-file edits as inline edit intent context', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const now = Date.parse('2026-05-27T00:00:05.000Z')
    const edit = createWriteRecentEdit({
      source: 'user',
      timestamp: now - 1_000,
      filePath: '/tmp/workspace/draft.md',
      from: 30,
      to: 42,
      deletedText: 'DeepSeek GUI',
      insertedText: 'Write mode',
      beforeContext: 'The name ',
      afterContext: ' appears twice.'
    })
    expect(edit).not.toBeNull()

    const context = recentEditsForInlineEdit(edit ? [edit] : [], {
      currentFilePath: '/tmp/workspace/draft.md',
      scope: { from: 80, to: 160 },
      now
    })

    expect(context).toHaveLength(1)
    expect(context[0]).toMatchObject({
      source: 'user',
      ageMs: 1_000,
      deletedText: 'DeepSeek GUI',
      insertedText: 'Write mode'
    })
    vi.restoreAllMocks()
  })

  it('filters stale and other-file edits', () => {
    const now = Date.parse('2026-05-27T00:03:00.000Z')
    const stale = createWriteRecentEdit({
      source: 'user',
      timestamp: now - 180_000,
      filePath: '/tmp/workspace/draft.md',
      from: 1,
      to: 1,
      insertedText: 'old'
    })
    const otherFile = createWriteRecentEdit({
      source: 'user',
      timestamp: now - 1_000,
      filePath: '/tmp/workspace/other.md',
      from: 1,
      to: 1,
      insertedText: 'other'
    })

    const edits = [stale, otherFile].filter((edit): edit is WriteRecentEdit => edit !== null)

    expect(trimWriteRecentEdits(edits, now)).toHaveLength(1)
    expect(recentEditsForInlineEdit(edits, {
      currentFilePath: '/tmp/workspace/draft.md',
      scope: { from: 1, to: 10 },
      now
    })).toHaveLength(0)
  })

  it('merges adjacent typing edits into one intent signal', () => {
    const now = Date.parse('2026-05-27T00:00:05.000Z')
    const edits = ['W', 'r', 'i', 't', 'e'].map((char, index) =>
      createWriteRecentEdit({
        source: 'user',
        timestamp: now + index * 100,
        filePath: '/tmp/workspace/draft.md',
        from: 20 + index,
        to: 20 + index,
        insertedText: char
      })
    ).filter((edit): edit is WriteRecentEdit => edit !== null)

    const trimmed = trimWriteRecentEdits(edits, now + 1_000)

    expect(trimmed).toHaveLength(1)
    expect(trimmed[0].insertedText).toBe('Write')
  })
})
