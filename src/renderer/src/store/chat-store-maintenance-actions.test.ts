import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadGoal, ThreadGoalStatus } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, SendMessageOverrides } from './chat-store-types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createMaintenanceActions } from './chat-store-maintenance-actions'

type GoalPatch = {
  objective?: string
  status?: ThreadGoalStatus
  tokenBudget?: number | null
}

type Harness = {
  actions: ReturnType<typeof createMaintenanceActions>
  createThread: ReturnType<typeof vi.fn>
  drainQueuedMessages: ReturnType<typeof vi.fn>
  get: ChatStoreGet
  provider: {
    setThreadGoal: ReturnType<typeof vi.fn>
    clearThreadGoal: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
  }
  refreshThreads: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  state: ChatState
}

function thread(id: string, goal: ThreadGoal | null = null): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-04T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'idle',
    goal
  }
}

function goal(
  threadId: string,
  objective = 'ship goal mode',
  status: ThreadGoalStatus = 'active'
): ThreadGoal {
  return {
    threadId,
    objective,
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:01:00.000Z'
  }
}

function buildHarness(options: {
  activeThreadId?: string | null
  createThreadSucceeds?: boolean
  initialGoal?: ThreadGoal | null
} = {}): Harness {
  const activeThreadId = options.activeThreadId === undefined ? 'thr_existing' : options.activeThreadId
  const createThreadSucceeds = options.createThreadSucceeds ?? true
  const initialGoal = options.initialGoal ?? null
  let state: ChatState

  const provider = {
    setThreadGoal: vi.fn(async (threadId: string, patch: GoalPatch) =>
      goal(
        threadId,
        patch.objective ?? state.activeThreadGoal?.objective ?? initialGoal?.objective ?? 'ship goal mode',
        patch.status ?? state.activeThreadGoal?.status ?? initialGoal?.status ?? 'active'
      )
    ),
    clearThreadGoal: vi.fn(async () => true),
    interruptTurn: vi.fn(async () => undefined)
  }
  registryMock.getProvider.mockReturnValue(provider)

  const createThread = vi.fn(async () => {
    if (!createThreadSucceeds) return
    const created = thread('thr_created')
    state.activeThreadId = created.id
    state.threads = [created, ...state.threads]
  })
  const refreshThreads = vi.fn(async () => undefined)
  const drainQueuedMessages = vi.fn(async () => undefined)
  const sendMessage = vi.fn(async (
    _text: string,
    _mode?: string,
    _overrides?: SendMessageOverrides
  ) => true)

  state = {
    activeThreadGoal: initialGoal,
    activeThreadId,
    createThread,
    error: null,
    drainQueuedMessages,
    refreshThreads,
    runtimeConnection: 'ready',
    sendMessage,
    settingsSection: 'general',
    threads: activeThreadId ? [thread(activeThreadId, initialGoal)] : []
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createMaintenanceActions({
    set,
    get,
    sseAbortRef: { current: null }
  })

  return { actions, createThread, drainQueuedMessages, get, provider, refreshThreads, sendMessage, state }
}

describe('chat-store-maintenance-actions goal actions', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
  })

  it('sets a goal on the active thread, syncs snapshots, and starts the goal turn', async () => {
    const { actions, provider, refreshThreads, sendMessage, state } = buildHarness()

    const result = await actions.setActiveThreadGoal('  ship goal mode  ')

    expect(result).toBe(true)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_existing', {
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(state.activeThreadGoal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(state.threads[0]?.goal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      'ship goal mode',
      'agent',
      expect.objectContaining({
        displayText: expect.stringContaining('ship goal mode')
      })
    )
  })

  it('creates a thread before setting the first goal when no thread is active', async () => {
    const { actions, createThread, provider, sendMessage, state } = buildHarness({
      activeThreadId: null
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(true)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_created', {
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(createThread.mock.invocationCallOrder[0]).toBeLessThan(
      provider.setThreadGoal.mock.invocationCallOrder[0]
    )
    expect(state.activeThreadId).toBe('thr_created')
    expect(state.activeThreadGoal?.threadId).toBe('thr_created')
    expect(state.threads[0]?.goal?.objective).toBe('ship goal mode')
    expect(sendMessage).toHaveBeenCalledWith(
      'ship goal mode',
      'agent',
      expect.objectContaining({
        displayText: expect.stringContaining('ship goal mode')
      })
    )
  })

  it('does not call goal APIs when a new thread cannot be created', async () => {
    const { actions, createThread, provider, sendMessage, state } = buildHarness({
      activeThreadId: null,
      createThreadSucceeds: false
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(false)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(provider.setThreadGoal).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.activeThreadGoal).toBeNull()
  })

  it('updates active goal status and keeps the thread snapshot in sync', async () => {
    const initialGoal = goal('thr_existing', 'finish testing', 'active')
    const { actions, provider, refreshThreads, state } = buildHarness({ initialGoal })

    const result = await actions.setActiveThreadGoalStatus('paused')

    expect(result).toBe(true)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_existing', { status: 'paused' })
    expect(state.activeThreadGoal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'finish testing',
      status: 'paused'
    })
    expect(state.threads[0]?.goal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'finish testing',
      status: 'paused'
    })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('clears the active goal and removes it from the thread snapshot', async () => {
    const initialGoal = goal('thr_existing', 'finish testing', 'active')
    const { actions, provider, refreshThreads, state } = buildHarness({ initialGoal })

    const result = await actions.clearActiveThreadGoal()

    expect(result).toBe(true)
    expect(provider.clearThreadGoal).toHaveBeenCalledWith('thr_existing')
    expect(state.activeThreadGoal).toBeNull()
    expect(state.threads[0]?.goal).toBeNull()
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('settles local runtime work after interrupt succeeds', async () => {
    const { actions, drainQueuedMessages, provider, refreshThreads, state } = buildHarness()
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      },
      {
        kind: 'approval',
        id: 'approval-1',
        approvalId: 'approval-1',
        summary: 'Approve command',
        status: 'pending'
      },
      {
        kind: 'user_input',
        id: 'input-1',
        requestId: 'input-1',
        questions: [],
        status: 'pending'
      }
    ]
    Object.assign(state, {
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      liveAssistant: 'partial answer',
      liveReasoning: '',
      queuedMessages: [],
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.interrupt()

    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn-1', { discard: false })
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.liveAssistant).toBe('')
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error',
      'error',
      'cancelled',
      'assistant'
    ])
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(drainQueuedMessages).toHaveBeenCalledTimes(1)
  })
})
