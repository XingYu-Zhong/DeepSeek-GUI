import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClawImChannelV1 } from '@shared/app-settings'
import { CLAW_MANAGED_INSTRUCTIONS_HEADING } from '@shared/app-settings'
import {
  MAX_TURN_MODEL_LABELS,
  MAX_CODE_WORKSPACE_ROOTS,
  clawThreadIdsFromChannels,
  clawThreadTitleLooksManaged,
  compactCodeWorkspaceRoots,
  hydrateBlockModelLabels,
  isClawThread,
  mergeComposerPickList,
  newClawChannel,
  normalizeTurnModelMap,
  rememberTurnModel
} from './chat-store-helpers'

const TURN_MODEL_STORAGE_KEY = 'deepseekgui.turnModelLabel'

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
    model: 'deepseek-v4-pro',
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

  it('collects channel and conversation thread ids for Claw sessions', () => {
    const ids = clawThreadIdsFromChannels([clawChannel()])

    expect(ids.has('kun-channel')).toBe(true)
    expect(ids.has('kun-conversation')).toBe(true)
  })

  it('omits legacy auto from composer model pick lists', () => {
    expect(mergeComposerPickList(true, ['auto', 'deepseek-v4-flash', 'custom-model'])).toEqual([
      'custom-model',
      'deepseek-v4-flash',
      'deepseek-v4-pro'
    ])
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
})
