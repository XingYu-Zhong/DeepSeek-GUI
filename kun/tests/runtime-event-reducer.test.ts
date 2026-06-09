import { describe, expect, it } from 'vitest'

import type { RuntimeEvent } from '../src/contracts/events.js'
import { emptyUsageSnapshot } from '../src/contracts/usage.js'
import { replayRuntimeEvents } from '../src/domain/runtime-event-reducer.js'

const timestamp = '2026-06-03T10:00:00.000Z'

function baseEvent(overrides: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'kind'>): RuntimeEvent {
  return {
    seq: overrides.seq ?? 1,
    timestamp: overrides.timestamp ?? timestamp,
    threadId: overrides.threadId ?? 'thread-1',
    ...overrides
  } as RuntimeEvent
}

describe('runtime event reducer', () => {
  it('replays thread, turn, and streaming text item state', () => {
    const events: RuntimeEvent[] = [
      baseEvent({
        kind: 'thread_created',
        seq: 1,
        title: 'Session'
      }),
      baseEvent({
        kind: 'turn_started',
        seq: 2,
        turnId: 'turn-1'
      }),
      baseEvent({
        kind: 'assistant_text_delta',
        seq: 3,
        turnId: 'turn-1',
        itemId: 'item-1',
        item: {
          id: 'item-1',
          turnId: 'turn-1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'running',
          createdAt: timestamp,
          kind: 'assistant_text',
          text: 'Hel'
        }
      }),
      baseEvent({
        kind: 'assistant_text_delta',
        seq: 4,
        turnId: 'turn-1',
        itemId: 'item-1',
        item: {
          id: 'item-1',
          turnId: 'turn-1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'completed',
          createdAt: timestamp,
          finishedAt: timestamp,
          kind: 'assistant_text',
          text: 'lo'
        }
      }),
      baseEvent({
        kind: 'turn_completed',
        seq: 5,
        turnId: 'turn-1'
      })
    ]

    const projection = replayRuntimeEvents(events)

    expect(projection.title).toBe('Session')
    expect(projection.lastSeq).toBe(5)
    expect(projection.turns).toEqual([
      expect.objectContaining({
        id: 'turn-1',
        status: 'completed',
        itemIds: ['item-1']
      })
    ])
    expect(projection.items).toEqual([
      expect.objectContaining({
        id: 'item-1',
        kind: 'assistant_text',
        text: 'Hello',
        status: 'completed'
      })
    ])
  })

  it('projects compactions and accumulates cache savings from usage events', () => {
    const usage = emptyUsageSnapshot()
    usage.promptTokens = 10
    usage.completionTokens = 2
    usage.totalTokens = 12
    usage.cacheSavingsUsd = 0.01
    usage.cacheSavingsCny = 0.07
    usage.tokenEconomySavingsTokens = 2048
    usage.tokenEconomySavingsUsd = 0.0009
    usage.tokenEconomySavingsCny = 0.0063

    const projection = replayRuntimeEvents([
      baseEvent({
        kind: 'usage',
        seq: 1,
        usage
      }),
      baseEvent({
        kind: 'compaction_completed',
        seq: 2,
        turnId: 'turn-1',
        itemId: 'compact-1',
        summary: 'Kept the core instructions.',
        replacedTokens: 200,
        pinnedConstraints: ['Active Skill: test']
      })
    ])

    expect(projection.usage.totalTokens).toBe(12)
    expect(projection.usage.cacheSavingsUsd).toBeCloseTo(0.01)
    expect(projection.usage.cacheSavingsCny).toBeCloseTo(0.07)
    expect(projection.usage.tokenEconomySavingsTokens).toBe(2048)
    expect(projection.usage.tokenEconomySavingsUsd).toBeCloseTo(0.0009)
    expect(projection.usage.tokenEconomySavingsCny).toBeCloseTo(0.0063)
    expect(projection.compactions).toEqual([
      expect.objectContaining({
        itemId: 'compact-1',
        replacedTokens: 200,
        pinnedConstraints: ['Active Skill: test']
      })
    ])
    expect(projection.items).toEqual([
      expect.objectContaining({
        id: 'compact-1',
        kind: 'compaction',
        summary: 'Kept the core instructions.',
        replacedTokens: 200
      })
    ])
  })

  it('keeps child run lifecycle separate from the parent turn', () => {
    const projection = replayRuntimeEvents([
      baseEvent({
        kind: 'turn_started',
        seq: 1,
        turnId: 'parent-turn'
      }),
      baseEvent({
        kind: 'turn_started',
        seq: 2,
        turnId: 'child-turn',
        child: {
          parentThreadId: 'thread-1',
          parentTurnId: 'parent-turn',
          childId: 'child-1',
          childLabel: 'analysis',
          childStatus: 'running',
          childSeq: 1
        }
      }),
      baseEvent({
        kind: 'turn_completed',
        seq: 3,
        turnId: 'child-turn',
        child: {
          parentThreadId: 'thread-1',
          parentTurnId: 'parent-turn',
          childId: 'child-1',
          childLabel: 'analysis',
          childStatus: 'completed',
          childSeq: 2
        }
      })
    ])

    expect(projection.turns).toEqual([
      expect.objectContaining({
        id: 'parent-turn',
        status: 'running'
      })
    ])
    expect(projection.childRuns).toEqual([
      expect.objectContaining({
        childId: 'child-1',
        label: 'analysis',
        status: 'completed',
        seq: 2
      })
    ])
  })

  it('records tool catalog drift and error items', () => {
    const projection = replayRuntimeEvents([
      baseEvent({
        kind: 'tool_catalog_changed',
        seq: 1,
        fingerprint: 'fp-2',
        toolCount: 2,
        toolNames: ['read', 'edit'],
        message: 'Catalog changed'
      }),
      baseEvent({
        kind: 'error',
        seq: 2,
        turnId: 'turn-1',
        itemId: 'error-1',
        message: 'Budget limit reached',
        code: 'budget_limited'
      })
    ])

    expect(projection.toolCatalog).toEqual({
      fingerprint: 'fp-2',
      toolCount: 2,
      toolNames: ['read', 'edit'],
      message: 'Catalog changed'
    })
    expect(projection.errors).toEqual([
      expect.objectContaining({
        seq: 2,
        turnId: 'turn-1',
        itemId: 'error-1',
        message: 'Budget limit reached',
        code: 'budget_limited'
      })
    ])
    expect(projection.items).toEqual([
      expect.objectContaining({
        id: 'error-1',
        kind: 'error',
        status: 'failed',
        message: 'Budget limit reached',
        code: 'budget_limited'
      })
    ])
  })
})
