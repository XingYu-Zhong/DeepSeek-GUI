import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { applyRequestHistoryHygiene } from './request-history-hygiene.js'

function toolResult(id: string, output: string): TurnItem {
  return {
    id: `item_${id}`,
    turnId: 'turn_1',
    threadId: 'thread_1',
    role: 'tool',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    kind: 'tool_result',
    toolName: 'read',
    callId: id,
    toolKind: 'tool_call',
    output,
    isError: false
  } as TurnItem
}

describe('applyRequestHistoryHygiene cumulative tool-result budget', () => {
  it('collapses older tool results once the cumulative budget is exhausted', () => {
    // Each result is ~250 ASCII tokens (1000 chars / 4). With a 600-token
    // budget and keepRecent=1, only the most recent couple should survive
    // verbatim; older ones become a one-line digest.
    const big = 'x'.repeat(1000)
    const items = [
      toolResult('a', big),
      toolResult('b', big),
      toolResult('c', big),
      toolResult('d', big)
    ]
    const out = applyRequestHistoryHygiene(items, {
      maxCumulativeToolResultTokens: 600,
      keepRecentToolResults: 1,
      // Keep per-result limits high so only the cumulative pass acts here.
      maxToolResultTokens: 100_000,
      maxToolResultBytes: 10_000_000,
      maxToolResultLines: 100_000
    })
    const outputs = out.map((item) => (item.kind === 'tool_result' ? String(item.output) : ''))
    // Newest (d) is always kept verbatim.
    expect(outputs[3]).toBe(big)
    // Oldest (a) must be collapsed to a digest marker.
    expect(outputs[0]).toContain('cache hygiene')
    expect(outputs[0]).not.toBe(big)
  })

  it('keeps everything when under budget', () => {
    const small = 'hello world'
    const items = [toolResult('a', small), toolResult('b', small)]
    const out = applyRequestHistoryHygiene(items, {
      maxCumulativeToolResultTokens: 100_000,
      keepRecentToolResults: 4
    })
    expect(out).toBe(items)
  })

  it('does nothing when no cumulative cap is configured', () => {
    const big = 'y'.repeat(5000)
    const items = [toolResult('a', big), toolResult('b', big)]
    const out = applyRequestHistoryHygiene(items, {
      maxCumulativeToolResultTokens: 0,
      maxToolResultTokens: 100_000,
      maxToolResultBytes: 10_000_000,
      maxToolResultLines: 100_000
    })
    expect(out).toBe(items)
  })
})
