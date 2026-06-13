import { describe, expect, it } from 'vitest'
import { nextVisibleLength } from './StreamdownAssistant'

describe('nextVisibleLength', () => {
  it('stays put when caught up', () => {
    expect(nextVisibleLength(120, 120)).toBe(120)
  })

  it('snaps down instantly when the live text resets', () => {
    expect(nextVisibleLength(120, 40)).toBe(40)
    expect(nextVisibleLength(120, 0)).toBe(0)
  })

  it('advances at least one char per frame on a small backlog', () => {
    expect(nextVisibleLength(100, 101)).toBe(101)
    expect(nextVisibleLength(100, 104)).toBe(101)
  })

  it('accelerates with backlog but caps the per-frame step so bursts stay readable', () => {
    expect(nextVisibleLength(0, 80)).toBe(10)
    expect(nextVisibleLength(0, 100_000)).toBe(32)
  })

  it('never overshoots the target', () => {
    let current = 0
    const target = 1234
    for (let i = 0; i < 10_000 && current < target; i += 1) {
      current = nextVisibleLength(current, target)
      expect(current).toBeLessThanOrEqual(target)
    }
    expect(current).toBe(target)
  })
})
