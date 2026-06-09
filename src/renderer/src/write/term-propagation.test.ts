import { describe, expect, it } from 'vitest'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges
} from './term-propagation'

function applyChanges(
  content: string,
  changes: Array<{ from: number; to: number; insert: string }>
): string {
  let next = content
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    next = `${next.slice(0, change.from)}${change.insert}${next.slice(change.to)}`
  }
  return next
}

describe('write term propagation', () => {
  it('propagates a case-only phrase replacement within the same paragraph', () => {
    const content = [
      'i build DeepSeek GUI, li is amazing ui production.',
      'deepseek gui can write paper, also can code. deepseek gui is use',
      'deepseek api, but it not only that.',
      '',
      'deepseek gui in another paragraph stays untouched.'
    ].join('\n')
    const seedFrom = content.indexOf('DeepSeek GUI')

    const changes = buildWriteTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 'DeepSeek GUI'.length,
      deletedText: 'deepseek gui',
      insertedText: 'DeepSeek GUI'
    })

    expect(changes).toHaveLength(2)
    expect(applyChanges(content, changes)).toBe([
      'i build DeepSeek GUI, li is amazing ui production.',
      'DeepSeek GUI can write paper, also can code. DeepSeek GUI is use',
      'deepseek api, but it not only that.',
      '',
      'deepseek gui in another paragraph stays untouched.'
    ].join('\n'))
  })

  it('propagates a term rename such as deepseek gui to DXGUI', () => {
    const content = 'DXGUI is here. deepseek gui is there. deepseek gui again.'
    const changes = buildWriteTermPropagationChanges(content, {
      from: 0,
      to: 'DXGUI'.length,
      deletedText: 'deepseek gui',
      insertedText: 'DXGUI'
    })

    expect(applyChanges(content, changes)).toBe('DXGUI is here. DXGUI is there. DXGUI again.')
  })

  it('does not replace partial word matches', () => {
    const content = 'DeepSeek GUI works. mydeepseek gui should not. deepseek gui should.'
    const seedFrom = content.indexOf('DeepSeek GUI')

    const changes = buildWriteTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 'DeepSeek GUI'.length,
      deletedText: 'deepseek gui',
      insertedText: 'DeepSeek GUI'
    })

    expect(applyChanges(content, changes)).toBe(
      'DeepSeek GUI works. mydeepseek gui should not. DeepSeek GUI should.'
    )
  })

  it('propagates canonical casing after an incremental case edit', () => {
    const content = 'DeepSeek GUI works. deepseek gui should follow. deepseek api should not.'
    const seedFrom = content.indexOf('DeepSeek GUI')

    const changes = buildWriteCanonicalTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 1,
      deletedText: 'd',
      insertedText: 'D'
    })

    expect(applyChanges(content, changes)).toBe(
      'DeepSeek GUI works. DeepSeek GUI should follow. deepseek api should not.'
    )
  })
})
