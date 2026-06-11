import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClawImChannelV1 } from '@shared/app-settings'
import { CLAW_MANAGED_INSTRUCTIONS_HEADING } from '@shared/app-settings'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  channelWithClawThreadMapping,
  clawThreadIdForProvider,
  createClawActions,
  findRecoverableClawThread,
  resolveClawThreadId
} from './chat-store-claw-actions'

function channel(overrides: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu Agent01',
    enabled: true,
    model: 'deepseek-v4-pro',
    threadId: 'thr-codewhale-channel',
    workspaceRoot: '/Users/zxy/.deepseekgui/claw/agent01',
    agentProfile: {
      name: '',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [
      {
        id: 'conversation-1',
        chatId: 'chat-1',
        remoteThreadId: '',
        latestMessageId: 'message-1',
        senderId: 'sender-1',
        senderName: 'Alex',
        localThreadId: 'thr-codewhale-conversation',
        workspaceRoot: '/Users/zxy/.deepseekgui/claw/agent01/conversations/chat-1',
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function thread(id: string, title: string, updatedAt = '2026-06-01T00:00:00.000Z'): NormalizedThread {
  return {
    id,
    title,
    updatedAt,
    model: 'reasonix',
    mode: 'agent',
    workspace: '/Users/zxy/.deepseekgui/default_workspace'
  }
}

describe('chat-store Claw actions helpers', () => {
  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('uses the channel threadId when the latest conversation has none', () => {
    const item = channel({ threadId: 'kun-channel-thread' })
    const conversation = { ...item.conversations[0], localThreadId: '' }
    expect(clawThreadIdForProvider(item, conversation)).toBe('kun-channel-thread')
  })

  it('recovers an unmapped Claw managed Kun session before creating a new empty one', () => {
    const item = channel()
    const recovered = findRecoverableClawThread(
      [
        thread('empty-claw-thread', '[Claw:Feishu Agent01]', '2026-06-01T00:02:00.000Z'),
        thread('old-content-thread', `${CLAW_MANAGED_INSTRUCTIONS_HEADING} DeepSeek GUI scheduled-task tools`, '2026-06-01T00:01:00.000Z')
      ],
      [item],
      item
    )

    expect(recovered?.id).toBe('old-content-thread')
  })

  it('writes recovered provider thread ids back to both channel and conversation', () => {
    const now = '2026-06-01T00:03:00.000Z'
    const next = channelWithClawThreadMapping(channel(), 'kun-thread', now, 'conversation-1')

    expect(next.threadId).toBe('kun-thread')
    expect(next.conversations[0]?.localThreadId).toBe('kun-thread')
  })

  it('drops stale configured thread ids and falls back to a recovered thread', () => {
    expect(
      resolveClawThreadId({
        configuredThreadId: 'thr_missing',
        recoveredThreadId: 'thr_recovered',
        configuredThreadExists: false,
        configuredThreadHasUserMessages: false
      })
    ).toBe('thr_recovered')
  })

  it('keeps the configured thread when it exists and already has conversation history', () => {
    expect(
      resolveClawThreadId({
        configuredThreadId: 'thr_live',
        recoveredThreadId: 'thr_recovered',
        configuredThreadExists: true,
        configuredThreadHasUserMessages: true
      })
    ).toBe('thr_live')
  })

  it('keeps an empty IM channel on the Claw route instead of selecting a stale missing thread', async () => {
    rendererRuntimeClient.invalidateSettings()
    let settings = {
      workspaceRoot: '/Users/zxy/project',
      claw: {
        enabled: true,
        im: {
          enabled: true,
          provider: 'feishu',
          workspaceRoot: '/Users/zxy/project'
        },
        channels: [channel({ threadId: 'thr_missing', conversations: [] })]
      }
    }
    const dsGui = {
      getSettings: vi.fn(async () => settings),
      setSettings: vi.fn(async (patch: { claw?: { channels?: ClawImChannelV1[] } }) => {
        settings = {
          ...settings,
          claw: {
            ...settings.claw,
            ...(patch.claw ?? {}),
            channels: patch.claw?.channels ?? settings.claw.channels
          }
        }
        return settings
      })
    }
    vi.stubGlobal('window', { dsGui })

    const provider = {
      createThread: vi.fn(),
      getThreadDetail: vi.fn(async () => {
        throw new Error('thread not found: thr_missing')
      }),
      deleteThread: vi.fn()
    }
    let state: Record<string, unknown> = {
      runtimeConnection: 'ready',
      route: 'chat',
      clawChannels: settings.claw.channels,
      activeClawChannelId: '',
      threads: [],
      activeThreadId: 'thr_previous',
      blocks: [{ kind: 'user', id: 'u1', text: 'hello' }],
      liveReasoning: '',
      liveAssistant: '',
      busy: false,
      lastSeq: 0,
      currentTurnId: null,
      currentTurnUserId: null,
      inspectorSelectedId: null,
      composerModel: 'deepseek-v4-pro',
      error: 'previous error'
    }
    const set = vi.fn((partial: Record<string, unknown> | ((current: typeof state) => Record<string, unknown>)) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...patch }
    })
    const actions = createClawActions({
      set: set as never,
      get: (() => state) as never,
      i18n: { t: (key: string) => key },
      getProvider: () => provider,
      newClawChannel: vi.fn() as never,
      normalizeClawComposerModel: (raw: string) => raw as never,
      activeClawChannel: vi.fn() as never,
      normalizeWorkspaceRoot: (workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '',
      formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
      shouldOpenSettingsForError: () => false,
      clearedThreadSelection: () => ({
        activeThreadId: null,
        blocks: [],
        liveReasoning: '',
        liveAssistant: '',
        busy: false,
        lastSeq: 0,
        currentTurnId: null,
        currentTurnUserId: null,
        inspectorSelectedId: null
      }),
      sseAbortRef: { current: null },
      clearBusyWatchdog: vi.fn()
    })

    await actions.selectClawChannel('channel-1')

    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.route).toBe('claw')
    expect(state.activeClawChannelId).toBe('channel-1')
    expect(state.activeThreadId).toBeNull()
    expect(state.error).toBeNull()
    expect(dsGui.setSettings).toHaveBeenCalledWith({
      claw: {
        channels: [expect.objectContaining({ id: 'channel-1', threadId: '' })]
      }
    })
  })
})
