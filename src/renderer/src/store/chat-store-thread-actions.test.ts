import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: true,
    clawChannels: [],
    composerModel: '',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnUserId: null,
    error: 'previous error',
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread('thr_existing')]
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

describe('chat-store-thread-actions queued messages', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not queue GUI plan messages while another turn is active', async () => {
    const { actions, state } = buildHarness()
    const guiPlan: GuiPlanMessageContext = {
      operation: 'draft',
      workspaceRoot: '/workspace/deepseek-gui',
      relativePath: '.kunsdd/plan/feature.md',
      planId: 'plan-1',
      sourceRequest: 'feature'
    }

    await expect(actions.sendMessage('prompt one', 'plan', {
      displayText: 'Generate implementation plan',
      guiPlan
    })).resolves.toBe(false)

    expect(state.queuedMessages).toHaveLength(0)
    expect(state.error).toBeTruthy()
  })

  it('removes stale queued GUI plan messages before draining normal queued messages', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [
      {
        id: 'q-plan',
        text: 'internal plan prompt',
        mode: 'plan',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/workspace/deepseek-gui',
          relativePath: '.kunsdd/plan/one.md',
          planId: 'plan-1'
        }
      },
      {
        id: 'q-user',
        text: 'normal follow-up',
        mode: 'agent'
      }
    ]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([])
    expect(sendMessage).toHaveBeenCalledWith('normal follow-up', 'agent', {
      queued: expect.objectContaining({ id: 'q-user' })
    })
  })

  it('applies the selected composer provider before sending a turn', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const saveSettingsSilent = vi.fn(async () => ({
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2-flash' } },
      codePromptPrefix: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M2' } },
          codePromptPrefix: ''
        })),
        saveSettingsSilent,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerModel = 'mimo-v2-flash'
    state.composerProviderId = 'xiaomi-token-plan'

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(true)

    expect(saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2-flash' } }
    })
    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello',
      expect.objectContaining({ model: 'mimo-v2-flash' })
    )
  })

  it('applies an override provider before sending from the write route', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const saveSettingsSilent = vi.fn(async () => ({
      agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M3' } },
      codePromptPrefix: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: ''
        })),
        saveSettingsSilent,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.route = 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing') as never

    await expect(actions.sendMessage('make a prototype', 'agent', {
      model: 'MiniMax-M3',
      providerId: 'minimax-token-plan'
    })).resolves.toBe(true)

    expect(saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M3' } }
    })
    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'make a prototype',
      expect.objectContaining({ model: 'MiniMax-M3' })
    )
  })
})
