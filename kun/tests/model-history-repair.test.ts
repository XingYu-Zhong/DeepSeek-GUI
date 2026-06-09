import { describe, expect, it } from 'vitest'
import { repairModelHistoryItems } from '../src/domain/model-history-repair.js'
import { healLoadedHistoryItems } from '../src/loop/history-healing.js'
import {
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../src/domain/item.js'

describe('model history repair', () => {
  it('keeps complete multi-tool blocks across assistant text bridges', () => {
    const orphanResult = makeToolResultItem({
      id: 'orphan_result',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_orphan',
      toolName: 'echo',
      output: 'orphan'
    })
    const missingCall = makeToolCallItem({
      id: 'missing_call',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_missing',
      toolName: 'echo',
      arguments: { text: 'missing' }
    })
    const callA = makeToolCallItem({
      id: 'call_a',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_a',
      toolName: 'echo',
      arguments: { text: 'a' }
    })
    const callB = makeToolCallItem({
      id: 'call_b',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_b',
      toolName: 'echo',
      arguments: { text: 'b' }
    })
    const bridgeText = makeAssistantTextItem({
      id: 'assistant_bridge',
      threadId: 'thr_1',
      turnId: 'turn_1',
      text: 'I will check both.',
      status: 'completed'
    })
    const resultA = makeToolResultItem({
      id: 'result_a',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_a',
      toolName: 'echo',
      output: 'a'
    })
    const resultB = makeToolResultItem({
      id: 'result_b',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_b',
      toolName: 'echo',
      output: 'b'
    })
    const duplicateResultB = makeToolResultItem({
      id: 'result_b_duplicate',
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_b',
      toolName: 'echo',
      output: 'duplicate'
    })

    const repaired = repairModelHistoryItems([
      orphanResult,
      missingCall,
      makeUserItem({ id: 'user_1', threadId: 'thr_1', turnId: 'turn_1', text: 'continue' }),
      callA,
      callB,
      bridgeText,
      resultA,
      resultB,
      duplicateResultB
    ])

    expect(repaired.map((item) => item.id)).toEqual([
      'user_1',
      'call_a',
      'call_b',
      'assistant_bridge',
      'result_a',
      'result_b'
    ])
  })

  it('keeps assistant text when dropping an incomplete tool call', () => {
    const repaired = repairModelHistoryItems([
      makeToolCallItem({
        id: 'call_missing',
        threadId: 'thr_1',
        turnId: 'turn_1',
        callId: 'call_missing',
        toolName: 'echo',
        arguments: { text: 'missing' }
      }),
      makeAssistantTextItem({
        id: 'assistant_text',
        threadId: 'thr_1',
        turnId: 'turn_1',
        text: 'I will use echo.',
        status: 'completed'
      }),
      makeUserItem({ id: 'user_next', threadId: 'thr_1', turnId: 'turn_2', text: 'never mind' }),
      makeToolResultItem({
        id: 'late_result',
        threadId: 'thr_1',
        turnId: 'turn_1',
        callId: 'call_missing',
        toolName: 'echo',
        output: 'late'
      })
    ])

    expect(repaired.map((item) => item.id)).toEqual(['assistant_text', 'user_next'])
  })

  it('heals loaded history by adding missing ids and dropping invalid tool items', () => {
    const assistant = makeAssistantTextItem({
      id: 'assistant_missing_id',
      threadId: 'thr_1',
      turnId: 'turn_1',
      text: 'hello',
      status: 'completed'
    }) as Record<string, unknown>
    delete assistant.id
    const invalidCall = {
      ...makeToolCallItem({
        id: 'bad_call',
        threadId: 'thr_1',
        turnId: 'turn_1',
        callId: 'call_bad',
        toolName: 'echo',
        arguments: {}
      }),
      callId: ''
    }
    const invalidResult = {
      ...makeToolResultItem({
        id: 'bad_result',
        threadId: 'thr_1',
        turnId: 'turn_1',
        callId: 'call_bad',
        toolName: 'echo',
        output: 'orphan'
      }),
      toolName: ''
    }

    const healed = healLoadedHistoryItems([
      assistant as never,
      invalidCall as never,
      invalidResult as never
    ])

    expect(healed.changed).toBe(true)
    expect(healed.items).toHaveLength(1)
    expect(healed.items[0]).toMatchObject({
      kind: 'assistant_text',
      id: 'item_healed_0_assistant_text'
    })
  })
})
