import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSideActions,
  teardownAllSideSubscriptions
} from './chat-store-side-actions'
import { DEFAULT_KUN_MODEL } from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import type { AgentProvider, NormalizedThread, ThreadEventSink } from '../agent/types'

type Harness = {
  state: ChatState
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
  provider: FakeProvider
  actions: ReturnType<typeof createSideActions>
}

class FakeProvider implements AgentProvider {
  readonly id = 'kun' as const
  readonly displayName = 'Fake'
  forkMock = vi.fn()
  sendMock = vi.fn()
  deleteMock = vi.fn()
  patchMock = vi.fn()
  interruptMock = vi.fn()
  subscribeMock = vi.fn()
  refreshThreadsMock = vi.fn()
  closeSideMock = vi.fn()
  getCapabilities() {
    return { interrupt: true, stream: true, approvals: true, attachFiles: false }
  }
  async connect() {}
  async listThreads(): Promise<NormalizedThread[]> {
    return []
  }
  async createThread(): Promise<NormalizedThread> {
    throw new Error('not used')
  }
  async getThreadDetail() {
    return { blocks: [], latestSeq: 0 }
  }
  async sendUserMessage(
    threadId: string,
    text: string,
    options?: { model?: string; reasoningEffort?: string }
  ) {
    this.sendMock(threadId, text, options)
    return { threadId, turnId: `turn_${threadId}_${Date.now()}` }
  }
  async steerUserMessage() {}
  async interruptTurn(threadId: string, turnId: string) {
    this.interruptMock(threadId, turnId)
  }
  async renameThread() {}
  async archiveThread() {}
  async deleteThread(threadId: string) {
    this.deleteMock(threadId)
  }
  async compactThread() {}
  async forkThread(
    threadId: string,
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ) {
    this.forkMock(threadId, options)
    return {
      id: `side_${threadId}`,
      title: options?.title ?? `${threadId} · side`,
      updatedAt: '2026-06-02T00:00:00.000Z',
      model: 'deepseek-chat',
      mode: 'agent',
      workspace: '/tmp',
      status: 'idle',
      relation: 'side' as const,
      parentThreadId: threadId,
      forkedFromThreadId: threadId,
      forkedFromTitle: 'Parent',
      forkedAt: '2026-06-02T00:00:00.000Z'
    }
  }
  async resumeSession() {
    return { threadId: 'resumed', sessionId: 'sid' }
  }
  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    this.subscribeMock(threadId, sinceSeq, sink, signal)
    signal.addEventListener('abort', () => {
      // simulate cleanup; the real implementation stops the SSE stream
    })
    return new Promise(() => {
      sink.onSeq(0)
    })
  }
  async submitApprovalDecision() {}
  async submitUserInputResponse() {}
  async cancelUserInput() {}
}

function buildHarness(overrides: Partial<ChatState> = {}): Harness {
  const state: ChatState = {
    route: 'chat',
    settingsReturnRoute: 'chat',
    pluginHostRoute: 'chat',
    settingsSection: 'general',
    initialSetupOpen: false,
    initialSetupMode: 'required',
    workspaceRoot: '/tmp',
    workspaceLabel: '/tmp',
    runtimeConnection: 'ready',
    codeWorkspaceRoots: [],
    threads: [
      {
        id: 'thr_main',
        title: 'Parent',
        updatedAt: '2026-06-02T00:00:00.000Z',
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'idle'
      }
    ],
    threadSearch: '',
    showArchivedThreads: false,
    activeThreadId: 'thr_main',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    runtimeErrorDetail: null,
    currentTurnId: 'turn_main',
    currentTurnUserId: 'item_main',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    composerModel: 'deepseek-chat',
    composerPickList: ['deepseek-chat'],
    queuedMessages: [],
    watchTurnCompletion: {},
    unreadThreadIds: {},
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    clawChannels: [],
    activeClawChannelId: '',
    appendLocalClawTurn: () => undefined,
    setError: () => undefined,
    setComposerModel: () => undefined,
    loadComposerModels: async () => undefined,
    setRoute: () => undefined,
    openWrite: async () => undefined,
    openCode: async () => undefined,
    ensureWriteThreadForWorkspace: async () => null,
    createWriteThread: async () => null,
    selectWriteThread: async () => undefined,
    openSettings: () => undefined,
    openPlugins: () => undefined,
    openClaw: () => undefined,
    refreshClawChannels: async () => undefined,
    addClawChannel: async () => undefined,
    selectClawChannel: async () => undefined,
    selectClawConversation: async () => undefined,
    deleteClawChannel: async () => undefined,
    resetClawChannelSession: async () => undefined,
    setClawChannelModel: async () => undefined,
    openInitialSetup: () => undefined,
    closeInitialSetup: () => undefined,
    boot: async () => undefined,
    probeRuntime: async () => undefined,
    chooseWorkspace: async () => null,
    clearWorkspace: async () => undefined,
    deleteWorkspace: async () => undefined,
    refreshThreads: async () => {
      provider.refreshThreadsMock()
    },
    setThreadSearch: () => undefined,
    setShowArchivedThreads: () => undefined,
    createThread: async () => undefined,
    selectThread: async () => undefined,
    recoverActiveTurn: async () => false,
    sendMessage: async () => false,
    drainQueuedMessages: async () => undefined,
    removeQueuedMessage: () => undefined,
    rewindAndResend: async () => undefined,
    interrupt: async () => undefined,
    renameActiveThread: async () => undefined,
    renameThread: async () => undefined,
    archiveThread: async () => undefined,
    compactActiveThread: async () => undefined,
    forkActiveThread: async () => undefined,
    spawnSideConversation: async () => null,
    openSideConversationDraft: () => undefined,
    sendSideMessage: async () => false,
    interruptSide: async () => undefined,
    setSideInput: () => undefined,
    setSideModel: () => undefined,
    setSideReasoningEffort: () => undefined,
    selectSideConversation: () => undefined,
    setSidePanelOpen: () => undefined,
    closeSideConversation: async () => undefined,
    discardSideConversation: async () => undefined,
    promoteSideConversation: async () => undefined,
    resumeSessionIntoThread: async () => null,
    deleteThread: async () => undefined,
    resolveApproval: async () => undefined,
    resolveUserInput: async () => undefined,
    selectInspectorItem: () => undefined,
    applyI18nFromSettings: async () => undefined,
    reloadUiSettings: async () => undefined,
    ...overrides
  } as ChatState
  const set: Harness['set'] = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: Harness['get'] = () => state
  const provider = new FakeProvider()
  const actions = createSideActions({
    set,
    get,
    getProvider: () => provider,
    t: (key) => key,
    formatRuntimeError: (e) => (e instanceof Error ? e.message : String(e ?? '')),
    shouldOpenSettingsForError: () => false
  })
  return { state, set, get, provider, actions }
}

describe('chat-store-side-actions', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
      }
    }
  })
  afterEach(() => {
    teardownAllSideSubscriptions()
    delete (globalThis as { window?: unknown }).window
  })

  it('spawnSideConversation does not change activeThreadId or main busy, even when main is running', async () => {
    const { actions, state, provider } = buildHarness()
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)

    const id = await actions.spawnSideConversation()

    expect(id).toBe('side_thr_main')
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)
    expect(state.sideConversations[id!]).toBeDefined()
    expect(state.sideConversations[id!].parentThreadId).toBe('thr_main')
    expect(state.sidePanel.open).toBe(true)
    expect(state.sidePanel.activeSideId).toBe(id)
    expect(provider.forkMock).toHaveBeenCalledWith('thr_main', { relation: 'side', title: 'Paren · side' })
    // A dedicated subscription was started for the side thread.
    expect(provider.subscribeMock).toHaveBeenCalledWith('side_thr_main', 0, expect.anything(), expect.anything())
  })

  it('openSideConversationDraft opens the side surface without forking a thread', () => {
    const { actions, state, provider } = buildHarness()

    actions.openSideConversationDraft()

    expect(state.sidePanel.open).toBe(true)
    expect(state.sidePanel.activeSideId).toBeNull()
    expect(state.sideConversations).toEqual({})
    expect(provider.forkMock).not.toHaveBeenCalled()
  })

  it('spawnSideConversation with seedText immediately sends the first turn', async () => {
    const { actions, state, provider } = buildHarness()
    const id = await actions.spawnSideConversation('what is the dependency tree?')
    expect(id).toBe('side_thr_main')
    expect(provider.sendMock).toHaveBeenCalledWith(
      'side_thr_main',
      'what is the dependency tree?',
      expect.objectContaining({ model: 'deepseek-chat', reasoningEffort: 'max' })
    )
    const side = state.sideConversations[id!]
    expect(side.busy).toBe(true)
    expect(side.turnId).toMatch(/^turn_side_thr_main_/)
    expect(side.input).toBe('')
  })

  it('sends the selected side reasoning effort with side turns', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    actions.setSideReasoningEffort(id, 'low')
    const sent = await actions.sendSideMessage(id, 'use less reasoning')

    expect(sent).toBe(true)
    expect(state.sideConversations[id].reasoningEffort).toBe('low')
    expect(provider.sendMock).toHaveBeenLastCalledWith(
      id,
      'use less reasoning',
      expect.objectContaining({
        model: 'deepseek-chat',
        reasoningEffort: 'low'
      })
    )
  })

  it('uses the Kun default model when side creation has no parent or composer model to inherit', async () => {
    const { actions, state } = buildHarness({
      threads: [],
      activeThreadId: 'thr_missing',
      composerModel: '',
      composerPickList: []
    })

    const id = await actions.spawnSideConversation()

    expect(id).toBe('side_thr_missing')
    expect(state.sideConversations[id!].model).toBe(DEFAULT_KUN_MODEL)
  })

  it('a side turn updates only its own blocks/busy and tears down its subscription on close', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    // The main thread is still untouched.
    expect(state.blocks).toEqual([])
    expect(state.busy).toBe(true)

    // Send a side message; only the side slice's busy flips.
    const sent = await actions.sendSideMessage(id, 'hi from side')
    expect(sent).toBe(true)
    expect(state.sideConversations[id].busy).toBe(true)
    expect(state.busy).toBe(true)

    // Close tears the subscription (abort() called on the controller).
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const signal = lastCall?.[3]
    expect(signal?.aborted).toBe(false)
    await actions.closeSideConversation(id)
    expect(state.sideConversations[id]).toBeUndefined()
    expect(signal?.aborted).toBe(true)
    expect(state.busy).toBe(true)
  })

  it('promoteSideConversation clears the relation by PATCH /v1/threads/{id} and refreshes the thread list', async () => {
    const { actions, state } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const runtimeRequest = globalThis.window.kunGui.runtimeRequest as ReturnType<typeof vi.fn>
    runtimeRequest.mockClear()

    await actions.promoteSideConversation(id)

    expect(runtimeRequest).toHaveBeenCalledWith(
      `/v1/threads/${id}`,
      'PATCH',
      JSON.stringify({ relation: 'primary' })
    )
    expect(state.sideConversations[id]).toBeUndefined()
  })

  it('discardSideConversation deletes the underlying thread and tears down the subscription', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const signal = lastCall?.[3]

    await actions.discardSideConversation(id)
    expect(provider.deleteMock).toHaveBeenCalledWith(id)
    expect(state.sideConversations[id]).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  })

  it('side state survives a main-thread switch: closing/discarding the side does not change activeThreadId', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    // Simulate the user picking a different main thread mid-side.
    state.activeThreadId = 'thr_other'
    state.busy = false
    await actions.closeSideConversation(id)
    expect(state.activeThreadId).toBe('thr_other')
    expect(state.busy).toBe(false)
  })
})
