import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClawImChannelV1 } from '@shared/app-settings'
import { CLAW_MANAGED_INSTRUCTIONS_HEADING } from '@shared/app-settings'
import {
  MAX_TURN_MODEL_LABELS,
  MAX_THREAD_COMPOSER_SELECTIONS,
  MAX_CODE_WORKSPACE_ROOTS,
  clawThreadIdsFromChannels,
  clawThreadTitleLooksManaged,
  compactCodeWorkspaceRoots,
  fallbackComposerModel,
  hydrateBlockModelLabels,
  isClawThread,
  mergeComposerPickList,
  newClawChannel,
  normalizeThreadComposerSelectionMap,
  normalizeTurnModelMap,
  readThreadComposerSelection,
  reconcileCodeWorkspaceRoots,
  rememberThreadComposerSelection,
  rememberTurnModel
} from './chat-store-helpers'

const TURN_MODEL_STORAGE_KEY = 'kun.turnModelLabel'
const THREAD_COMPOSER_SELECTION_STORAGE_KEY = 'kun.threadComposerSelection.v1'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

function clawChannel(): ClawImChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu Agent',
    enabled: true,
    model: 'auto',
    threadId: 'kun-channel',
    workspaceRoot: '/Users/zxy/project',
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
        remoteThreadId: 'remote-1',
        latestMessageId: 'message-1',
        senderId: 'sender-1',
        senderName: 'Alex',
        localThreadId: 'kun-conversation',
        workspaceRoot: '/Users/zxy/project',
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  }
}

describe('chat-store Claw helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('compacts code workspace roots while excluding write, temporary, and Claw roots', () => {
    expect(
      compactCodeWorkspaceRoots([
        '/Users/zxy/project-a',
        '/Users/zxy/project-a/',
        '/tmp/transient',
        '/Users/zxy/.deepseekgui/claw/agent/conversations/chat',
        '/Users/zxy/.deepseekgui/default_workspace',
        '~/.deepseekgui/write_workspace',
        '',
        '/Users/zxy/project-b'
      ])
    ).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/.deepseekgui/default_workspace',
      '/Users/zxy/project-b'
    ])
  })

  it('deduplicates default workspace aliases', () => {
    expect(
      compactCodeWorkspaceRoots([
        '~/.deepseekgui/default_workspace',
        'C:\\Users\\zxy\\.deepseekgui\\default_workspace',
        'C:\\Users\\zxy\\.deepseekgui\\default_workspace\\'
      ])
    ).toEqual(['~/.deepseekgui/default_workspace'])
  })

  it('caps code workspace roots while keeping the newest unique roots first', () => {
    const roots = Array.from({ length: MAX_CODE_WORKSPACE_ROOTS + 4 }, (_, index) =>
      `/Users/zxy/project-${index}`
    )

    const compacted = compactCodeWorkspaceRoots([
      roots[0],
      roots[0].toUpperCase(),
      ...roots
    ])

    expect(compacted).toHaveLength(MAX_CODE_WORKSPACE_ROOTS)
    expect(compacted[0]).toBe('/Users/zxy/project-0')
    expect(compacted.at(-1)).toBe(`/Users/zxy/project-${MAX_CODE_WORKSPACE_ROOTS - 1}`)
    expect(compacted).not.toContain(`/Users/zxy/project-${MAX_CODE_WORKSPACE_ROOTS}`)
  })

  it('drops remembered write-only workspaces from the code workspace list', () => {
    expect(
      reconcileCodeWorkspaceRoots({
        currentRoots: [
          '/Users/zxy/code-project',
          '/Users/zxy/CodeLLMPaper',
          '/Users/zxy/shared-project'
        ],
        codeThreadWorkspaceRoots: ['/Users/zxy/shared-project'],
        writeWorkspaceRoots: [
          '/Users/zxy/CodeLLMPaper',
          '/Users/zxy/shared-project'
        ],
        preservedWorkspaceRoots: ['/Users/zxy/active-code']
      })
    ).toEqual([
      '/Users/zxy/shared-project',
      '/Users/zxy/code-project',
      '/Users/zxy/active-code'
    ])
  })

  it('collects channel and conversation thread ids for Claw sessions', () => {
    const ids = clawThreadIdsFromChannels([clawChannel()])

    expect(ids.has('kun-channel')).toBe(true)
    expect(ids.has('kun-conversation')).toBe(true)
  })

  it('uses product default agent names for new Claw channels', () => {
    const feishu = newClawChannel('feishu')
    const weixin = newClawChannel('weixin')

    expect(feishu.label).toBe('feishu agent')
    expect(feishu.agentProfile.name).toBe('feishu agent')
    expect(weixin.label).toBe('weixin agent')
    expect(weixin.agentProfile.name).toBe('weixin agent')
  })

  it('recognizes Claw managed prompt summaries as Claw sessions', () => {
    expect(
      clawThreadTitleLooksManaged(`${CLAW_MANAGED_INSTRUCTIONS_HEADING} DeepSeek GUI scheduled-task tools`)
    ).toBe(true)
    expect(isClawThread({ id: 'kun-leaked', title: '[Claw:Feishu Agent]' })).toBe(true)
  })

  it('recognizes Claw sessions by registered thread id', () => {
    expect(
      isClawThread(
        { id: 'kun-conversation', title: 'hi' },
        [clawChannel()]
      )
    ).toBe(true)
  })

  it('keeps auto out of the composer pick list', () => {
    const pick = mergeComposerPickList(true, ['auto', 'custom-model', ' '])

    expect(pick).not.toContain('auto')
    expect(pick).toContain('custom-model')
    expect(pick).toContain('deepseek-v4-pro')
    expect(pick).toContain('deepseek-v4-flash')
    expect(mergeComposerPickList(false, ['upstream-model'])).not.toContain('upstream-model')
  })

  it('falls back to the runtime default model, then known defaults', () => {
    const pick = ['a-model', 'custom-model', 'deepseek-v4-flash', 'deepseek-v4-pro']

    expect(fallbackComposerModel(pick, 'custom-model')).toBe('custom-model')
    expect(fallbackComposerModel(pick, 'auto')).toBe('deepseek-v4-pro')
    expect(fallbackComposerModel(pick, 'missing-model')).toBe('deepseek-v4-pro')
    expect(fallbackComposerModel(['a-model'], '')).toBe('a-model')
    expect(fallbackComposerModel([], '')).toBe('')
  })

  it('normalizes and caps persisted turn model labels', () => {
    const raw: Record<string, unknown> = {
      'bad-key': 'bad-model',
      'thread-empty|item-empty': '',
      'thread-number|item-number': 42
    }
    for (let index = 0; index < MAX_TURN_MODEL_LABELS + 5; index += 1) {
      raw[`thread-${index}|item-${index}`] = ` model-${index} `
    }

    const normalized = normalizeTurnModelMap(raw)

    expect(Object.keys(normalized)).toHaveLength(MAX_TURN_MODEL_LABELS)
    expect(normalized['thread-0|item-0']).toBeUndefined()
    expect(normalized['thread-5|item-5']).toBe('model-5')
    expect(normalized['thread-empty|item-empty']).toBeUndefined()
    expect(normalized['thread-number|item-number']).toBeUndefined()
    expect(normalized['bad-key']).toBeUndefined()
  })

  it('persists turn model labels with trimming, pruning, and hydration support', () => {
    const raw: Record<string, string> = {}
    for (let index = 0; index < MAX_TURN_MODEL_LABELS; index += 1) {
      raw[`thread-${index}|item-${index}`] = `model-${index}`
    }
    localStorage.setItem(TURN_MODEL_STORAGE_KEY, JSON.stringify(raw))

    rememberTurnModel(' thread-new ', ' item-new ', ' deepseek-chat ')

    const stored = JSON.parse(localStorage.getItem(TURN_MODEL_STORAGE_KEY) ?? '{}') as Record<string, string>
    expect(Object.keys(stored)).toHaveLength(MAX_TURN_MODEL_LABELS)
    expect(stored['thread-0|item-0']).toBeUndefined()
    expect(stored['thread-new|item-new']).toBe('deepseek-chat')
    expect(
      hydrateBlockModelLabels('thread-new', [
        { kind: 'user', id: 'item-new', text: 'hello' },
        { kind: 'assistant', id: 'assistant-1', text: 'hi' }
      ])
    ).toEqual([
      { kind: 'user', id: 'item-new', text: 'hello', modelLabel: 'deepseek-chat' },
      { kind: 'assistant', id: 'assistant-1', text: 'hi' }
    ])
  })

  it('normalizes and caps per-thread composer selections', () => {
    const raw: Record<string, unknown> = {
      'bad-empty-model': { model: '' },
      'bad-number': 42
    }
    for (let index = 0; index < MAX_THREAD_COMPOSER_SELECTIONS + 5; index += 1) {
      raw[`thread-${index}`] = {
        model: ` model-${index} `,
        providerId: ` provider-${index} `
      }
    }

    const normalized = normalizeThreadComposerSelectionMap(raw)

    expect(Object.keys(normalized)).toHaveLength(MAX_THREAD_COMPOSER_SELECTIONS)
    expect(normalized['thread-0']).toBeUndefined()
    expect(normalized['thread-5']).toEqual({ model: 'model-5', providerId: 'provider-5' })
    expect(normalized['bad-empty-model']).toBeUndefined()
    expect(normalized['bad-number']).toBeUndefined()
  })

  it('persists composer model selections independently per thread', () => {
    rememberThreadComposerSelection(' thread-a ', ' deepseek-v4-pro ', ' deepseek ')
    rememberThreadComposerSelection(' thread-b ', ' MiniMax-M2 ', ' minimax ')

    expect(readThreadComposerSelection('thread-a')).toEqual({
      model: 'deepseek-v4-pro',
      providerId: 'deepseek'
    })
    expect(readThreadComposerSelection('thread-b')).toEqual({
      model: 'MiniMax-M2',
      providerId: 'minimax'
    })
    expect(JSON.parse(localStorage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY) ?? '{}')).toMatchObject({
      'thread-a': { model: 'deepseek-v4-pro', providerId: 'deepseek' },
      'thread-b': { model: 'MiniMax-M2', providerId: 'minimax' }
    })
  })
})
