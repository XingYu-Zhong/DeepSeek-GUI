import { describe, expect, it } from 'vitest'
import { deriveTimelineVisibleTurnCount } from './use-timeline-scroll'

describe('deriveTimelineVisibleTurnCount', () => {
  it('keeps long conversations on the latest page instead of expanding all turns', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 18,
        totalTurns: 36,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: false
      })
    ).toBe(18)
  })

  it('renders every turn for short conversations below the collapse threshold', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 5,
        totalTurns: 6,
        pageSize: 18,
        shouldCollapseHistory: false,
        historyExpansionRequested: false
      })
    ).toBe(6)
  })

  it('preserves a user-expanded history window while new turns arrive', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 36,
        totalTurns: 50,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(36)
  })

  it('caps a user-expanded history window at the current turn count', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 36,
        totalTurns: 24,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(24)
  })
})
