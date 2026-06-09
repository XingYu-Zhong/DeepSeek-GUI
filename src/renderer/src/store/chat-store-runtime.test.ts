import { afterEach, describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  clearWatchedCompletionNotifications,
  clearPendingClawFeishuMirrors,
  completionNotificationDedupeKeyForWatchedThread,
  MAX_PENDING_CLAW_FEISHU_MIRRORS,
  MAX_WATCHED_COMPLETION_NOTIFICATIONS,
  rememberPendingClawFeishuMirror,
  takePendingClawFeishuMirror,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import type { ChatState, ChatStoreSet } from './chat-store-types'

function makeSinkHarness(overrides: Partial<ChatState> = {}): {
  getState: () => ChatState
  set: ChatStoreSet
  get: () => ChatState
} {
  let state = {
    activeThreadId: 'thread-current',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-current',
    currentTurnUserId: 'user-current',
    turnStartedAtByUserId: { 'user-current': 1000 },
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    threads: []
  } as unknown as ChatState
  state = { ...state, ...overrides }
  const get = (): ChatState => state
  const set: ChatStoreSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  return {
    getState: () => state,
    set,
    get
  }
}

describe('thread event sink binding', () => {
  it('ignores reasoning deltas from a stream bound to a different active thread', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-new' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-old',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'old reasoning', seq: 7 }])

    expect(getState().liveReasoning).toBe('')
    expect(getState().lastSeq).toBe(0)
  })

  it('ignores queued callbacks after a stream has been aborted', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      liveReasoning: 'current reasoning'
    })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    controller.abort()
    sink.onDeltas([{ kind: 'agent_reasoning', text: 'late old reasoning', seq: 8 }])
    sink.onTurnComplete()

    expect(getState().liveReasoning).toBe('current reasoning')
    expect(getState().blocks).toEqual([])
    expect(getState().busy).toBe(true)
  })

  it('accepts reasoning deltas from the current active stream', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'fresh reasoning', seq: 9 }])

    expect(getState().liveReasoning).toBe('fresh reasoning')
    expect(getState().lastSeq).toBe(9)
    expect(getState().turnReasoningFirstAtByUserId['user-current']).toEqual(expect.any(Number))
  })
})

describe('thread event sink runtime errors', () => {
  it('does not keep an aborted turn busy after interrupt', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      }
    ]
    const state = {
      activeThreadId: 'thr-1',
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      error: null,
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    } as unknown as ChatState
    const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    }

    buildThreadEventSink(set, () => state).onError(new Error('turn aborted'))

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error'
    ])
  })
})

describe('pending Claw Feishu mirrors', () => {
  afterEach(() => {
    clearPendingClawFeishuMirrors()
  })

  it('normalizes pending mirror fields before storing', () => {
    rememberPendingClawFeishuMirror(' turn-1 ', {
      threadId: ' thread-1 ',
      userBlockId: ' user-1 ',
      userText: ' hello '
    })

    expect(takePendingClawFeishuMirror('turn-1')).toEqual({
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
  })

  it('ignores invalid pending mirrors', () => {
    rememberPendingClawFeishuMirror('', {
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
    rememberPendingClawFeishuMirror('turn-2', {
      threadId: ' ',
      userBlockId: 'user-2',
      userText: 'hello'
    })
    rememberPendingClawFeishuMirror('turn-3', {
      threadId: 'thread-3',
      userBlockId: 'user-3',
      userText: ' '
    })

    expect(takePendingClawFeishuMirror('')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-2')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-3')).toBeUndefined()
  })

  it('caps pending mirrors and keeps the latest turns', () => {
    for (let index = 0; index < MAX_PENDING_CLAW_FEISHU_MIRRORS + 5; index += 1) {
      rememberPendingClawFeishuMirror(`turn-${index}`, {
        threadId: `thread-${index}`,
        userBlockId: `user-${index}`,
        userText: `hello-${index}`
      })
    }

    expect(takePendingClawFeishuMirror('turn-0')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-4')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-5')).toEqual({
      threadId: 'thread-5',
      userBlockId: 'user-5',
      userText: 'hello-5'
    })
    expect(takePendingClawFeishuMirror(`turn-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`)).toEqual({
      threadId: `thread-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`,
      userBlockId: `user-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`,
      userText: `hello-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`
    })
  })

  it('removes a pending mirror when taking it', () => {
    rememberPendingClawFeishuMirror('turn-1', {
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })

    expect(takePendingClawFeishuMirror(' turn-1 ')).toEqual({
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
    expect(takePendingClawFeishuMirror('turn-1')).toBeUndefined()
  })
})

describe('watched completion notifications', () => {
  afterEach(() => {
    clearWatchedCompletionNotifications()
  })

  it('normalizes watched thread ids before storing and clearing', () => {
    watchTurnCompletionNotification(' thread-1 ', 1000)

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 2000)).toBe('watch:thread-1:1000')

    clearWatchedCompletionNotification(' thread-1 ')

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 2000)).toBe('watch:thread-1:2000')
  })

  it('ignores empty watched thread ids', () => {
    watchTurnCompletionNotification(' ', 1000)

    expect(completionNotificationDedupeKeyForWatchedThread('', 2000)).toBe('watch:unknown:2000')
  })

  it('caps watched completion notifications and keeps the latest thread watches', () => {
    for (let index = 0; index < MAX_WATCHED_COMPLETION_NOTIFICATIONS + 5; index += 1) {
      watchTurnCompletionNotification(`thread-${index}`, index)
    }

    expect(completionNotificationDedupeKeyForWatchedThread('thread-0', 999)).toBe('watch:thread-0:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-4', 999)).toBe('watch:thread-4:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-5', 999)).toBe('watch:thread-5:5')
    expect(
      completionNotificationDedupeKeyForWatchedThread(`thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}`, 999)
    ).toBe(`watch:thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}:${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}`)
  })

  it('refreshes existing watched threads as the most recent entry', () => {
    watchTurnCompletionNotification('thread-0', 0)
    for (let index = 1; index < MAX_WATCHED_COMPLETION_NOTIFICATIONS; index += 1) {
      watchTurnCompletionNotification(`thread-${index}`, index)
    }
    watchTurnCompletionNotification('thread-0', 1000)
    watchTurnCompletionNotification(`thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS}`, 2000)

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 999)).toBe('watch:thread-1:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-0', 999)).toBe('watch:thread-0:1000')
  })
})
