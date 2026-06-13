import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createNavigationActions } from './chat-store-navigation-actions'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-12T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createNavigationActions>
  state: ChatState
  createThread: ReturnType<typeof vi.fn>
  refreshThreads: ReturnType<typeof vi.fn>
  selectThread: ReturnType<typeof vi.fn>
} {
  const createThread = vi.fn(async () => undefined)
  const refreshThreads = vi.fn(async () => undefined)
  const selectThread = vi.fn(async () => undefined)
  let state = {
    activeThreadId: 'thr_default',
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: ['~/.kun/default_workspace'],
    createThread,
    currentTurnId: null,
    currentTurnUserId: null,
    error: null,
    openWrite: vi.fn(async () => undefined),
    refreshThreads,
    route: 'chat',
    runtimeConnection: 'ready',
    selectThread,
    threads: [
      thread({
        id: 'thr_default',
        title: 'Only default thread',
        workspace: '~/.kun/default_workspace'
      })
    ],
    unreadThreadIds: {},
    watchTurnCompletion: {},
    workspaceLabel: 'default_workspace',
    workspaceRoot: '~/.kun/default_workspace'
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  return {
    actions: createNavigationActions({
      set,
      get,
      sseAbortRef: { current: null }
    }),
    get state() {
      return state
    },
    createThread,
    refreshThreads,
    selectThread
  }
}

describe('chat-store navigation workspace selection', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not move the only default thread into a newly picked empty workspace', async () => {
    const provider = {
      updateThreadWorkspace: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const pickWorkspaceDirectory = vi.fn(async () => ({
      canceled: false,
      path: '/Users/zxy/new-project'
    }))
    const setSettings = vi.fn(async () => ({
      workspaceRoot: '/Users/zxy/new-project'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        pickWorkspaceDirectory,
        setSettings
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.chooseWorkspace()).resolves.toBe('/Users/zxy/new-project')

    expect(pickWorkspaceDirectory).toHaveBeenCalledWith('~/.kun/default_workspace')
    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(provider.updateThreadWorkspace).not.toHaveBeenCalled()
    expect(harness.state.threads.find((item) => item.id === 'thr_default')?.workspace)
      .toBe('~/.kun/default_workspace')
    expect(harness.createThread).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.selectThread).not.toHaveBeenCalled()
  })
})
