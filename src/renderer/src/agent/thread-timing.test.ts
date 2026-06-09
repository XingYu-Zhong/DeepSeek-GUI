import { describe, expect, it } from 'vitest'
import { buildTurnDurationByUserId } from './thread-timing'

describe('buildTurnDurationByUserId', () => {
  it('maps completed runtime turns to their user message duration', () => {
    const durations = buildTurnDurationByUserId(
      [
        {
          id: 'turn-1',
          item_ids: ['user-1', 'assistant-1'],
          started_at: '2026-05-25T09:00:00.000Z',
          ended_at: '2026-05-25T09:01:12.500Z'
        }
      ],
      [
        { id: 'user-1', turn_id: 'turn-1', kind: 'user_message' },
        { id: 'assistant-1', turn_id: 'turn-1', kind: 'agent_message' }
      ]
    )

    expect(durations).toEqual({ 'user-1': 72_500 })
  })

  it('falls back to item timestamps when the turn range is incomplete', () => {
    const durations = buildTurnDurationByUserId(
      [
        {
          id: 'turn-2',
          item_ids: ['user-2', 'tool-2', 'assistant-2']
        }
      ],
      [
        {
          id: 'user-2',
          kind: 'user_message',
          started_at: '2026-05-25T09:00:00.000Z'
        },
        {
          id: 'tool-2',
          kind: 'command_execution',
          started_at: '2026-05-25T09:00:02.000Z',
          ended_at: '2026-05-25T09:00:07.000Z'
        },
        {
          id: 'assistant-2',
          kind: 'agent_message',
          started_at: '2026-05-25T09:00:07.000Z',
          ended_at: '2026-05-25T09:00:09.250Z'
        }
      ]
    )

    expect(durations).toEqual({ 'user-2': 9_250 })
  })

  it('ignores turns without a valid user item or positive time range', () => {
    const durations = buildTurnDurationByUserId(
      [
        {
          id: 'turn-without-user',
          item_ids: ['assistant-3'],
          started_at: '2026-05-25T09:00:00.000Z',
          ended_at: '2026-05-25T09:00:01.000Z'
        },
        {
          id: 'turn-negative',
          item_ids: ['user-4'],
          started_at: '2026-05-25T09:00:02.000Z',
          ended_at: '2026-05-25T09:00:01.000Z'
        }
      ],
      [
        { id: 'assistant-3', kind: 'agent_message' },
        { id: 'user-4', kind: 'user_message' }
      ]
    )

    expect(durations).toEqual({})
  })
})
