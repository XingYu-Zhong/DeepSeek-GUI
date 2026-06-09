import { describe, expect, it } from 'vitest'
import { DEFAULT_APPROVAL_POLICY } from '../src/contracts/policy.js'
import { createThreadRecord, touchThread, toThreadSummary } from '../src/domain/thread.js'
import {
  appendTurnItem,
  createTurnRecord,
  finishTurn,
  replaceTurnItem,
  startTurn
} from '../src/domain/turn.js'
import {
  makeApprovalItem,
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeCompactionItem,
  makeErrorItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '../src/domain/item.js'
import { compareEventSeq, groupEventsByKind } from '../src/domain/event.js'
import {
  createApprovalRequest,
  expireApprovalRequest,
  resolveApprovalRequest
} from '../src/domain/approval.js'
import { addUsage, zeroUsage } from '../src/domain/usage.js'
import {
  appendSessionEvent,
  appendSessionItem,
  closeSession,
  createAgentSession
} from '../src/domain/session.js'

describe('domain.thread', () => {
  it('creates a thread with sensible defaults', () => {
    const thread = createThreadRecord({
      id: 'thr_1',
      title: 'demo',
      workspace: '/tmp',
      model: 'deepseek-chat'
    })
    expect(thread.status).toBe('idle')
    expect(thread.mode).toBe('agent')
    expect(thread.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
  })

  it('touches a thread to refresh updatedAt', () => {
    const thread = createThreadRecord({
      id: 'thr_1',
      title: 'demo',
      workspace: '/tmp',
      model: 'deepseek-chat'
    })
    const touched = touchThread(thread, '2025-06-01T00:00:00.000Z')
    expect(touched.updatedAt).toBe('2025-06-01T00:00:00.000Z')
  })

  it('produces a thread summary with the canonical fields', () => {
    const thread = createThreadRecord({
      id: 'thr_1',
      title: 'demo',
      workspace: '/tmp',
      model: 'deepseek-chat'
    })
    const summary = toThreadSummary(thread)
    expect(summary).not.toHaveProperty('turns')
  })
})

describe('domain.turn', () => {
  const baseTurn = createTurnRecord({
    id: 'turn_1',
    threadId: 'thr_1',
    prompt: 'hi'
  })

  it('appends items without duplicates', () => {
    const item = makeUserItem({ id: 'i1', turnId: 'turn_1', threadId: 'thr_1', text: 'hi' })
    const next = appendTurnItem(appendTurnItem(baseTurn, item), item)
    expect(next.items).toHaveLength(1)
  })

  it('replaces an existing item with the same id', () => {
    const partial = makeToolResultItem({
      id: 'item_call_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      callId: 'call_1',
      toolName: 'bash',
      output: { partial: true },
      status: 'running'
    })
    const final = makeToolResultItem({
      id: 'item_call_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      callId: 'call_1',
      toolName: 'bash',
      output: { exit_code: 127 },
      isError: true,
      status: 'completed'
    })
    const next = appendTurnItem(appendTurnItem(baseTurn, partial), final)

    expect(next.items).toHaveLength(1)
    expect(next.items[0]).toMatchObject({
      id: 'item_call_1',
      status: 'completed',
      isError: true,
      output: { exit_code: 127 }
    })
  })

  it('replaces an item by id', () => {
    const item = makeAssistantTextItem({
      id: 'i2',
      turnId: 'turn_1',
      threadId: 'thr_1',
      text: 'hello',
      status: 'running'
    })
    const appended = appendTurnItem(baseTurn, item)
    const replaced = replaceTurnItem(appended, 'i2', { text: 'world', status: 'completed' })
    const found = replaced.items.find((it) => it.id === 'i2')
    expect(found && found.kind === 'assistant_text' ? found.text : '').toBe('world')
  })

  it('starts and finishes a turn', () => {
    const started = startTurn(baseTurn)
    const finished = finishTurn(started, 'completed')
    expect(finished.status).toBe('completed')
    expect(finished.finishedAt).toBeDefined()
  })
})

describe('domain.item factories', () => {
  it('makes user/assistant/tool/approval/compaction/error items', () => {
    const user = makeUserItem({
      id: 'u',
      turnId: 't',
      threadId: 'th',
      text: 'hi',
      attachmentIds: ['att_1']
    })
    const assistant = makeAssistantTextItem({ id: 'a', turnId: 't', threadId: 'th', text: 'reply' })
    const reasoning = makeAssistantReasoningItem({
      id: 'r',
      turnId: 't',
      threadId: 'th',
      text: 'thinking'
    })
    const call = makeToolCallItem({
      id: 'c',
      turnId: 't',
      threadId: 'th',
      callId: 'call_1',
      toolName: 'echo',
      arguments: { text: 'hi' }
    })
    const result = makeToolResultItem({
      id: 'cr',
      turnId: 't',
      threadId: 'th',
      callId: 'call_1',
      toolName: 'echo',
      output: { ok: true }
    })
    const approval = makeApprovalItem({
      id: 'ap',
      turnId: 't',
      threadId: 'th',
      approvalId: 'appr_1',
      toolName: 'shell',
      summary: 'run shell'
    })
    const input = makeUserInputItem({
      id: 'in',
      turnId: 't',
      threadId: 'th',
      inputId: 'in_1',
      prompt: '?'
    })
    const compaction = makeCompactionItem({
      id: 'cp',
      turnId: 't',
      threadId: 'th',
      summary: 'compact',
      replacedTokens: 12,
      pinnedConstraints: ['user: do not delete']
    })
    const error = makeErrorItem({
      id: 'er',
      turnId: 't',
      threadId: 'th',
      message: 'boom'
    })
    expect([user, assistant, reasoning, call, result, approval, input, compaction, error]).toHaveLength(9)
    expect(user).toMatchObject({ attachmentIds: ['att_1'] })
  })
})

describe('domain.event helpers', () => {
  it('orders events by seq', () => {
    const events = [
      { kind: 'heartbeat' as const, seq: 2, timestamp: 't', threadId: 'th' },
      { kind: 'heartbeat' as const, seq: 1, timestamp: 't', threadId: 'th' }
    ]
    expect([...events].sort(compareEventSeq)).toEqual([events[1], events[0]])
  })

  it('groups events by kind', () => {
    const events = [
      { kind: 'heartbeat' as const, seq: 1, timestamp: 't', threadId: 'th' },
      {
        kind: 'turn_started' as const,
        seq: 2,
        timestamp: 't',
        threadId: 'th',
        turnId: 'turn_1'
      }
    ]
    const grouped = groupEventsByKind(events)
    expect(grouped.heartbeat).toHaveLength(1)
    expect(grouped.turn_started).toHaveLength(1)
  })
})

describe('domain.approval', () => {
  it('creates a pending approval', () => {
    const approval = createApprovalRequest({
      id: 'a',
      threadId: 'th',
      turnId: 't',
      toolName: 'echo',
      summary: 'run echo'
    })
    expect(approval.status).toBe('pending')
  })

  it('resolves an approval to allowed/denied', () => {
    const approval = createApprovalRequest({
      id: 'a',
      threadId: 'th',
      turnId: 't',
      toolName: 'echo',
      summary: 'run echo'
    })
    expect(resolveApprovalRequest(approval, 'allow').status).toBe('allowed')
    expect(resolveApprovalRequest(approval, 'deny').status).toBe('denied')
  })

  it('expires an approval', () => {
    const approval = createApprovalRequest({
      id: 'a',
      threadId: 'th',
      turnId: 't',
      toolName: 'echo',
      summary: 'run echo'
    })
    expect(expireApprovalRequest(approval).status).toBe('expired')
  })
})

describe('domain.usage', () => {
  it('adds two usage snapshots and reports a cache hit rate', () => {
    const a = { ...zeroUsage(), promptTokens: 100, completionTokens: 5, cacheHitTokens: 4, cachedTokens: 4, cacheMissTokens: 1, totalTokens: 105 }
    const b = { ...zeroUsage(), promptTokens: 200, completionTokens: 10, cacheHitTokens: 5, cachedTokens: 5, cacheMissTokens: 0, totalTokens: 210 }
    const merged = addUsage(a, b)
    expect(merged.promptTokens).toBe(300)
    expect(merged.cacheHitRate).toBeCloseTo(9 / 10)
  })

  it('reports a null cache hit rate when prompt tokens are zero', () => {
    expect(addUsage(zeroUsage(), zeroUsage()).cacheHitRate).toBeNull()
  })
})

describe('domain.session', () => {
  it('appends items and events without duplicates', () => {
    const session = createAgentSession({ threadId: 'th', turnId: 't' })
    const item = makeUserItem({ id: 'u', turnId: 't', threadId: 'th', text: 'hi' })
    const event = { kind: 'turn_started' as const, seq: 1, timestamp: 't', threadId: 'th', turnId: 't' }
    const after = appendSessionItem(appendSessionEvent(session, event), item)
    const same = appendSessionItem(appendSessionEvent(after, event), item)
    expect(same.items).toHaveLength(1)
    expect(same.events).toHaveLength(1)
  })

  it('closes a session', () => {
    const session = createAgentSession({ threadId: 'th', turnId: 't' })
    expect(closeSession(session).closed).toBe(true)
  })
})
