import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImConversationV1,
  type ModelProviderProfileV1
} from '../shared/app-settings'
import { createClawRuntime } from './claw-runtime'

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    claw: {
      ...defaultClawSettings(),
      enabled: true,
      tasks: [
        {
          id: 'task_1',
          title: 'Task 1',
          enabled: true,
          prompt: 'Summarize changes',
          workspaceRoot: '/tmp/workspace',
          clawChannelId: '',
          model: 'auto',
          reasoningEffort: 'medium',
          mode: 'agent',
          schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
          lastRunAt: '',
          nextRunAt: '',
          lastStatus: 'idle',
          lastMessage: '',
          lastThreadId: ''
        }
      ]
    },
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function buildConversation(overrides: Partial<ClawImConversationV1> = {}): ClawImConversationV1 {
  return {
    id: 'conv_1',
    chatId: 'oc_chat_a',
    remoteThreadId: '',
    latestMessageId: 'om_previous',
    senderId: 'ou_1',
    senderName: 'Alice',
    localThreadId: 'thr_old',
    workspaceRoot: '/tmp/workspace/conversations/oc_chat_a',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function buildChannel(overrides: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  return {
    id: 'channel_1',
    provider: 'feishu' as const,
    label: 'Phone',
    enabled: true,
    model: 'auto',
    threadId: 'thr_old',
    workspaceRoot: '/tmp/workspace',
    agentProfile: {
      name: 'kun',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    // Most tests model an already-greeted channel; welcome tests reset
    // this to '' to exercise the first-contact intro.
    welcomeSentAt: '2026-06-02T00:00:00.000Z',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function buildModelProvider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'minimax',
    name: 'MiniMax',
    apiKey: 'sk-minimax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    models: ['MiniMax-M3', 'MiniMax-M2.7'],
    modelProfiles: {},
    ...overrides
  }
}

function mutableSettingsStore(initialSettings: AppSettingsV1): {
  current: () => AppSettingsV1
  store: {
    load: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
  }
} {
  let currentSettings = initialSettings
  const store = {
    load: vi.fn(async () => currentSettings),
    patch: vi.fn(async (partial: Partial<AppSettingsV1>) => {
      currentSettings = {
        ...currentSettings,
        ...partial,
        claw: partial.claw
          ? {
              ...currentSettings.claw,
              ...partial.claw,
              im: partial.claw.im
                ? { ...currentSettings.claw.im, ...partial.claw.im }
                : currentSettings.claw.im
            }
          : currentSettings.claw
      }
      return currentSettings
    })
  }
  return { current: () => currentSettings, store }
}

describe('ClawRuntime', () => {
  it('bases Feishu conversation workspaces on the configured Claw workspace', () => {
    const settings = buildSettings()
    settings.claw.im.workspaceRoot = '/tmp/claw-default'
    const channel: ClawImChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.claw.channels = [channel]
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: undefined,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, undefined, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default/conversations/oc_chat_a')
  })

  it('repairs legacy Feishu conversation workspaces created from an empty channel root', () => {
    const settings = buildSettings()
    settings.claw.im.workspaceRoot = '/tmp/claw-default'
    const conversation: ClawImConversationV1 = {
      id: 'conv_1',
      chatId: 'oc_chat_a',
      remoteThreadId: '',
      latestMessageId: 'msg_1',
      senderId: 'ou_1',
      senderName: 'Alice',
      localThreadId: 'thr_1',
      workspaceRoot: '/conversations/oc_chat_a',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    const channel: ClawImChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [conversation],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.claw.channels = [channel]
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: typeof conversation,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, conversation, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default/conversations/oc_chat_a')
  })

  it('delegates reminder creation to Schedule without writing claw tasks', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const createScheduledTaskFromText = vi.fn(async () => ({
      kind: 'created' as const,
      taskId: 'schedule-task-1',
      title: 'Reminder',
      scheduleAt: '2026-06-03T09:00:00.000+08:00',
      confirmationText: 'Scheduled.'
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({ text: 'Remind me tomorrow to ship the review.' })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toEqual({
      ok: true,
      createdTaskId: 'schedule-task-1',
      reply: 'Scheduled.'
    })
    expect(createScheduledTaskFromText).toHaveBeenCalledWith('Remind me tomorrow to ship the review.', {
      workspaceRoot: settings.workspaceRoot,
      clawChannelId: null,
      providerId: null,
      modelHint: settings.claw.im.model,
      mode: settings.claw.im.mode
    })
    expect(store.patch).not.toHaveBeenCalled()
    expect(settings.claw.tasks).toHaveLength(1)
  })

  it('reports that scheduled tasks have moved to Schedule', async () => {
    const settings = buildSettings()
    let currentSettings = settings
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' }) }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const store = {
      load: vi.fn(async () => currentSettings),
      patch: vi.fn(async (partial: Partial<AppSettingsV1>) => {
        currentSettings = {
          ...currentSettings,
          ...partial,
          claw: { ...currentSettings.claw, ...(partial.claw ?? {}) }
        }
        return currentSettings
      })
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await runtime.runTask('task_1')

    expect(result).toEqual({ ok: false, message: 'Claw scheduled tasks have moved to Schedule.' })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('accepts assistant_text items when waiting for a Claw turn result', async () => {
    const settings = buildSettings()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            thread: { id: 'thr_1', status: 'completed' },
            turns: [{ id: 'turn_1', status: 'completed' }],
            items: [{ kind: 'assistant_text', detail: 'hello from claw' }]
          })
        }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' }) }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 10,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, text: 'hello from claw' })
    const createThreadCall = runtimeRequest.mock.calls.find(
      ([, path, init]) => path === '/v1/threads' && init?.method === 'POST'
    )
    expect(JSON.parse(String(createThreadCall?.[2]?.body ?? '{}'))).toMatchObject({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    const turnCall = runtimeRequest.mock.calls.find(
      ([, path, init]) => path === '/v1/threads/thr_1/turns' && init?.method === 'POST'
    )
    expect(JSON.parse(String(turnCall?.[2]?.body ?? '{}'))).toMatchObject({
      disableUserInput: true,
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
  })

  it('reads assistant text from the Kun thread detail shape used by the real runtime', async () => {
    const settings = buildSettings()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            latestSeq: 3,
            turns: [
              {
                id: 'turn_1',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from nested turn items' }]
              }
            ]
          })
        }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' }) }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, text: 'hello from nested turn items' })
  })

  it('replaces a missing configured IM thread before starting a new inbound turn', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const onTurnStarted = vi.fn()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_missing/turns') {
        return {
          ok: false,
          status: 404,
          body: JSON.stringify({ code: 'not_found', message: 'thread not found: thr_missing' })
        }
      }
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_replacement' }) }
      }
      if (path === '/v1/threads/thr_replacement' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_replacement/turns') {
        return {
          ok: true,
          status: 202,
          body: JSON.stringify({ threadId: 'thr_replacement', turnId: 'turn_replacement' })
        }
      }
      if (path === '/v1/threads/thr_replacement' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_replacement',
            status: 'idle',
            turns: [
              {
                id: 'turn_replacement',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'recovered reply' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest,
      logError
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
          threadId?: string
          onTurnStarted?: (payload: { threadId: string; turnId: string }) => Promise<void> | void
        }
      ) => Promise<{ ok: boolean; threadId?: string; turnId?: string; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im',
      threadId: 'thr_missing',
      onTurnStarted
    })

    expect(result).toMatchObject({
      ok: true,
      threadId: 'thr_replacement',
      turnId: 'turn_replacement',
      text: 'recovered reply'
    })
    expect(onTurnStarted).toHaveBeenCalledWith({
      threadId: 'thr_replacement',
      turnId: 'turn_replacement'
    })
    expect(logError).toHaveBeenCalledWith(
      'claw-runtime',
      'Configured IM thread was missing; creating a replacement thread.',
      expect.objectContaining({ threadId: 'thr_missing', source: 'im' })
    )
  })

  it('falls back to a plain Feishu chat message when replying to an inbound message fails', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError
    })

    const result = await (runtime as unknown as {
      sendFeishuMessage: (
        bridge: { send: typeof send },
        to: string,
        input: { markdown: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: undefined, replyInThread: undefined }
    )
    expect(logError).toHaveBeenCalledWith(
      'claw-feishu',
      'Failed to send Feishu / Lark reply; falling back to plain chat message.',
      expect.objectContaining({
        channelId: 'channel_1',
        message: 'reply permission denied',
        purpose: 'agent-reply',
        replyTo: 'om_inbound',
        to: 'oc_chat_a'
      })
    )
  })

  it('handles Feishu /new locally by clearing the mapped IM thread', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    const conversation = buildConversation()
    settings.claw.channels = [buildChannel({ conversations: [conversation] })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/new',
      rawContentType: 'text',
      mentions: []
    })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Started a new topic. The next message will create a fresh local conversation.' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
    expect(current().claw.channels[0].threadId).toBe('')
    expect(current().claw.channels[0].conversations[0].localThreadId).toBe('')
    expect(current().claw.channels[0].remoteSession?.messageId).toBe('om_inbound')
  })

  it('handles Feishu model commands locally for the current IM channel', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel()]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '-model flash',
      rawContentType: 'text',
      mentions: []
    })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(current().claw.channels[0].model).toBe('deepseek-v4-flash')
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Claw IM model switched to `deepseek-v4-flash`.' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
  })

  it('lists and switches IM model providers locally for the current channel', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.provider.providers = [
      ...settings.provider.providers,
      buildModelProvider()
    ]
    settings.claw.channels = [buildChannel()]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })
    const handleFeishuMessage = (content: string, messageId: string): Promise<void> =>
      (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId,
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content,
        rawContentType: 'text',
        mentions: []
      })

    await handleFeishuMessage('/provider', 'om_provider_list')
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith(
      'oc_chat_a',
      { markdown: expect.stringContaining('Loaded providers:') },
      { replyTo: 'om_provider_list', replyInThread: false }
    )
    const providerListCall = send.mock.calls[send.mock.calls.length - 1] as unknown as [
      string,
      { markdown?: string },
      Record<string, unknown>
    ]
    expect(providerListCall[1]).toMatchObject({ markdown: expect.stringContaining('`minimax`') })

    await handleFeishuMessage('/provider minimax', 'om_provider_switch')
    expect(current().claw.channels[0]).toMatchObject({
      providerId: 'minimax',
      model: 'MiniMax-M2.7'
    })
    expect(send).toHaveBeenLastCalledWith(
      'oc_chat_a',
      { markdown: 'IM provider switched to `minimax`; model is `MiniMax-M2.7`. Send `/model` to list models for this provider.' },
      { replyTo: 'om_provider_switch', replyInThread: false }
    )
  })

  it('lists and switches models only within the current IM provider', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.provider.providers = [
      ...settings.provider.providers,
      buildModelProvider()
    ]
    settings.claw.channels = [buildChannel({ providerId: 'minimax', model: 'MiniMax-M2.7' })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })
    const handleFeishuMessage = (content: string, messageId: string): Promise<void> =>
      (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId,
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content,
        rawContentType: 'text',
        mentions: []
      })

    await handleFeishuMessage('/model', 'om_model_list')
    expect(send).toHaveBeenLastCalledWith(
      'oc_chat_a',
      { markdown: expect.stringContaining('Available models:') },
      { replyTo: 'om_model_list', replyInThread: false }
    )
    const modelListCall = send.mock.calls[send.mock.calls.length - 1] as unknown as [
      string,
      { markdown?: string },
      Record<string, unknown>
    ]
    expect(modelListCall[1]).toMatchObject({ markdown: expect.stringContaining('`MiniMax-M3`') })
    expect(modelListCall[1]).toMatchObject({ markdown: expect.not.stringContaining('deepseek-v4-flash') })

    await handleFeishuMessage('/model MiniMax-M3', 'om_model_switch')
    expect(current().claw.channels[0].model).toBe('MiniMax-M3')
    expect(send).toHaveBeenLastCalledWith(
      'oc_chat_a',
      { markdown: 'Claw IM model switched to `MiniMax-M3`.' },
      { replyTo: 'om_model_switch', replyInThread: false }
    )
  })

  it('uses the current IM provider when starting an agent turn', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.provider.providers = [
      ...settings.provider.providers,
      buildModelProvider()
    ]
    settings.claw.channels = [buildChannel({
      providerId: 'minimax',
      model: 'MiniMax-M3',
      threadId: 'thr_minimax',
      conversations: [buildConversation({ localThreadId: 'thr_minimax' })]
    })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (requestSettings: AppSettingsV1, path, init) => {
      expect(requestSettings.agents.kun.providerId).toBe('minimax')
      expect(requestSettings.agents.kun.model).toBe('MiniMax-M3')
      if (path === '/v1/threads/thr_minimax/turns' && init?.method === 'POST') {
        const body = JSON.parse(init?.body ?? '{}') as { model?: string }
        expect(body.model).toBe('MiniMax-M3')
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_minimax', turnId: 'turn_minimax' }) }
      }
      if (path === '/v1/threads/thr_minimax' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_minimax',
            status: 'idle',
            turns: [
              {
                id: 'turn_minimax',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from minimax' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'hello',
      rawContentType: 'text',
      mentions: []
    })

    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'hello from minimax' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
  })

  it('handles webhook /help as an IM command before starting a Kun turn', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({ provider: 'weixin' as const, id: 'channel_weixin' })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const createScheduledTaskFromText = vi.fn()
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({ text: '/help', provider: 'weixin', channelId: 'channel_weixin' })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Claw IM commands:')
    })
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('records WeChat webhook conversations and returns the GUI-generated reply', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_weixin',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from GUI' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: 'hello from GUI'
    })
    expect(current().claw.channels[0].threadId).toBe('thr_weixin')
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      localThreadId: 'thr_weixin'
    })
    const turnCall = runtimeRequest.mock.calls.find(
      ([, path, init]) => path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST'
    )
    expect(turnCall).toBeDefined()
    expect(JSON.parse(String(turnCall?.[2]?.body ?? '{}'))).toMatchObject({
      disableUserInput: true,
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
  })

  it('backfills a WeChat conversation when an existing channel thread handles the webhook', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_weixin',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from existing thread' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: 'hello from existing thread'
    })
    expect(current().claw.channels[0].threadId).toBe('thr_weixin')
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      localThreadId: 'thr_weixin'
    })
  })

  it('backfills a WeChat conversation from legacy webhook sender fields', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_weixin',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from legacy sender' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      sender: 'wx_user_1'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: 'hello from legacy sender'
    })
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      senderId: 'wx_user_1',
      senderName: 'wx_user_1',
      localThreadId: 'thr_weixin'
    })
    expect(current().claw.channels[0].conversations[0].latestMessageId).toMatch(/^wx_/)
  })

  it('sends the channel intro before handling the first Feishu message', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({ welcomeSentAt: '' })]
    const { current, store } = mutableSettingsStore(settings)
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/help',
      rawContentType: 'text',
      mentions: []
    })

    expect(send).toHaveBeenCalledTimes(2)
    const welcomeCall = send.mock.calls[0] as unknown as [string, { markdown?: string }, Record<string, unknown>]
    expect(welcomeCall[0]).toBe('oc_chat_a')
    expect(welcomeCall[1].markdown).toContain('Kun')
    expect(welcomeCall[1].markdown).toContain('`/new`')
    expect(welcomeCall[1].markdown).toContain('`/model`')
    expect(welcomeCall[2]).toEqual({})
    expect(current().claw.channels[0].welcomeSentAt).toBeTruthy()

    send.mockClear()
    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: Record<string, unknown>) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_2',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/help',
      rawContentType: 'text',
      mentions: []
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('pushes the WeChat intro as its own message on first contact and keeps the reply clean', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: [],
      welcomeSentAt: '',
      platformCredential: {
        kind: 'weixin',
        accountId: 'acc_1',
        sessionKey: 'sess_1',
        createdAt: '2026-06-02T00:00:00.000Z'
      }
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_weixin',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from GUI' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const sendWeixinBridgeMessage = vi.fn(async () => ({ ok: true as const, messageId: 'wx_out_1' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      sendWeixinBridgeMessage,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({ ok: true, reply: 'hello from GUI' })
    expect(sendWeixinBridgeMessage).toHaveBeenCalledTimes(1)
    expect(sendWeixinBridgeMessage).toHaveBeenCalledWith({
      accountId: 'acc_1',
      to: 'wx_user_1',
      text: expect.stringContaining('`/new`')
    })
    expect(current().claw.channels[0].welcomeSentAt).toBeTruthy()
  })

  it('prepends the intro to the first webhook reply when no push channel exists', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: [],
      welcomeSentAt: ''
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_weixin',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from GUI' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let responseBody = ''
    const res = {
      writeHead: vi.fn(),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    const reply = String(JSON.parse(responseBody).reply)
    expect(reply).toContain('Kun')
    expect(reply).toContain('`/new`')
    expect(reply.endsWith('hello from GUI')).toBe(true)
    expect(current().claw.channels[0].welcomeSentAt).toBeTruthy()
  })

  it('greets the WeChat owner right after the channel is first connected', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      welcomeSentAt: '',
      platformCredential: {
        kind: 'weixin',
        accountId: 'acc_1',
        sessionKey: 'sess_1',
        createdAt: '2026-06-02T00:00:00.000Z'
      }
    })]
    const { current, store } = mutableSettingsStore(settings)
    const sendWeixinBridgeMessage = vi.fn(async () => ({ ok: true as const, messageId: 'wx_out_1' }))
    const resolveWeixinAccountUserId = vi.fn(async () => 'owner_1')
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      sendWeixinBridgeMessage,
      resolveWeixinAccountUserId
    })

    const internals = runtime as unknown as {
      syncWeixinConnectWelcomes: (settings: AppSettingsV1) => Promise<void>
    }
    await internals.syncWeixinConnectWelcomes(settings)

    expect(resolveWeixinAccountUserId).toHaveBeenCalledWith('acc_1')
    expect(sendWeixinBridgeMessage).toHaveBeenCalledTimes(1)
    expect(sendWeixinBridgeMessage).toHaveBeenCalledWith({
      accountId: 'acc_1',
      to: 'owner_1',
      text: expect.stringContaining('`/help`')
    })
    expect(current().claw.channels[0].welcomeSentAt).toBeTruthy()

    await internals.syncWeixinConnectWelcomes(current())
    expect(sendWeixinBridgeMessage).toHaveBeenCalledTimes(1)
  })

  it('waits for the current WeChat turn to complete before returning the final reply', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { store } = mutableSettingsStore(settings)
    let getCount = 0
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        getCount += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(getCount === 1
            ? {
                id: 'thr_weixin',
                status: 'running',
                turns: [
                  {
                    id: 'turn_previous',
                    status: 'completed',
                    items: [{ kind: 'assistant_text', text: 'previous reply' }]
                  },
                  {
                    id: 'turn_weixin',
                    status: 'running',
                    items: [
                      { kind: 'assistant_text', text: 'intermediate reply' },
                      { kind: 'tool_call', detail: 'checking disk usage' }
                    ]
                  }
                ]
              }
            : {
                id: 'thr_weixin',
                status: 'idle',
                turns: [
                  {
                    id: 'turn_previous',
                    status: 'completed',
                    items: [{ kind: 'assistant_text', text: 'previous reply' }]
                  },
                  {
                    id: 'turn_weixin',
                    status: 'completed',
                    items: [
                      { kind: 'assistant_text', text: 'intermediate reply' },
                      { kind: 'tool_result', detail: 'tool finished' },
                      { kind: 'assistant_text', text: 'final result' }
                    ]
                  }
                ]
              })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'clean disk',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: 'final result'
    })
    expect(getCount).toBe(2)
  })

  it('does not return a previous WeChat session reply for a new turn', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 10
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_weixin'
      })]
    })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_previous',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'previous reply' }]
              },
              {
                id: 'turn_current',
                status: 'completed',
                items: []
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: false,
      message: 'Timed out waiting for agent response.'
    })
  })

  it('does not return historical WeChat text when the current turn fails', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_weixin'
      })]
    })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_previous',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'previous reply' }]
              },
              {
                id: 'turn_current',
                status: 'failed',
                items: []
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: false,
      message: 'Agent turn failed.'
    })
  })

  it('mirrors local Claw thread messages back to the bundled WeChat bridge', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'wx_out_1'
    }))
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'hello from local', 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendWeixinBridgeMessage).toHaveBeenCalledWith({
      accountId: 'wx_account',
      to: 'wx_user_1',
      text: 'hello from local'
    })
  })

  it('sends the latest generated workspace file to Feishu when the user asks for it', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-feishu-file-'))
    const filePath = join(workspaceRoot, 'hello.md')
    await writeFile(filePath, '# Hello\n')
    const realFilePath = await realpath(filePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      const conversation: ClawImConversationV1 = {
        id: 'conv_1',
        chatId: 'oc_chat_a',
        remoteThreadId: '',
        latestMessageId: 'om_previous',
        senderId: 'ou_1',
        senderName: 'Alice',
        localThreadId: 'thr_1',
        workspaceRoot,
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
      const channel: ClawImChannelV1 = {
        id: 'channel_1',
        provider: 'feishu' as const,
        label: 'Phone',
        enabled: true,
        model: 'auto',
        threadId: '',
        workspaceRoot,
        agentProfile: {
          name: 'kun',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        conversations: [conversation],
        welcomeSentAt: '2026-06-02T00:00:00.000Z',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
      settings.claw.channels = [channel]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_1/turns') {
          return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_2' }) }
        }
        if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_1',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolKind: 'file_change',
                      output: {
                        path: filePath,
                        relative_path: 'hello.md',
                        bytes_written: 8
                      },
                      isError: false
                    }
                  ]
                },
                {
                  id: 'turn_2',
                  status: 'completed',
                  items: [
                    {
                      kind: 'assistant_text',
                      text: '我无法直接通过飞书发送文件给你，但文件已经创建在 workspace 中。'
                    }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const send = vi.fn(async () => ({ messageId: 'om_sent' }))
      const addReaction = vi.fn(async () => 'rc_file_1')
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
        logError: () => undefined
      })
      ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
        .feishuChannels
        .set('channel_1', { send, addReaction })

      await (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          threadId?: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId: 'om_inbound',
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content: '发给我',
        rawContentType: 'text',
        mentions: []
      })

      expect(send).toHaveBeenNthCalledWith(
        1,
        'oc_chat_a',
        { markdown: '可以，我把 hello.md 作为附件发给你。' },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      expect(send).toHaveBeenNthCalledWith(
        2,
        'oc_chat_a',
        { file: { source: realFilePath, fileName: 'hello.md' } },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      // The direct-file path is fast (synchronous file lookup + upload) and
      // The direct-file path is fast (synchronous file lookup + upload) and
      // must NOT add a pending reaction — that would be visually noisy.
      const addReactionSpy = (runtime as unknown as { feishuChannels: Map<string, { addReaction: ReturnType<typeof vi.fn> }> })
        .feishuChannels.get('channel_1')?.addReaction
      expect(addReactionSpy).not.toHaveBeenCalled()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('sends generated image tool output to Feishu for image requests', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-feishu-image-'))
    const imageDir = join(workspaceRoot, '.deepseekgui-images')
    const imagePath = join(imageDir, 'img-20260611000100-abcd.png')
    await mkdir(imageDir, { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const realImagePath = await realpath(imagePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.imageGeneration = {
        enabled: true,
        providerId: '',
        protocol: 'openai-images',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'sk-image',
        model: 'test-image-model',
        defaultSize: '1024x1024',
        timeoutMs: 180000
      }
      settings.claw.channels = [
        buildChannel({
          threadId: 'thr_1',
          workspaceRoot,
          conversations: [buildConversation({ localThreadId: 'thr_1', workspaceRoot })]
        })
      ]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_1/turns') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expect(body.prompt).toContain('generate_image')
          return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_img' }) }
        }
        if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_img',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_image',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: imagePath,
                          relativePath: '.deepseekgui-images/img-20260611000100-abcd.png',
                          mimeType: 'image/png'
                        }],
                        endpoint: 'generations'
                      },
                      isError: false
                    },
                    {
                      kind: 'assistant_text',
                      text: '图片已生成。'
                    }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const send = vi.fn(async () => ({ messageId: 'om_sent' }))
      const addReaction = vi.fn(async () => 'rc_image_1')
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
        logError: () => undefined
      })
      ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
        .feishuChannels
        .set('channel_1', { send, addReaction })

      await (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          threadId?: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId: 'om_inbound',
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content: '帮我生成一张图片',
        rawContentType: 'text',
        mentions: []
      })

      expect(addReaction).toHaveBeenCalledWith('om_inbound', 'OnIt')
      expect(send).toHaveBeenNthCalledWith(
        1,
        'oc_chat_a',
        { markdown: '图片已生成。' },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      expect(send).toHaveBeenNthCalledWith(
        2,
        'oc_chat_a',
        { file: { source: realImagePath, fileName: 'img-20260611000100-abcd.png' } },
        { replyTo: 'om_inbound', replyInThread: false }
      )
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns generated files in the WeChat webhook reply for image requests', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-image-'))
    const imageDir = join(workspaceRoot, '.deepseekgui-images')
    const imagePath = join(imageDir, 'img-20260611000200-beef.png')
    await mkdir(imageDir, { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const realImagePath = await realpath(imagePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.imageGeneration = {
        enabled: true,
        providerId: '',
        protocol: 'openai-images',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'sk-image',
        model: 'test-image-model',
        defaultSize: '1024x1024',
        timeoutMs: 180000
      }
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx',
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expect(body.prompt).toContain('generate_image')
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_img' }) }
        }
        if (path === '/v1/threads/thr_wx' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx',
              status: 'idle',
              turns: [
                {
                  id: 'turn_wx_img',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_image',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: imagePath,
                          relativePath: '.deepseekgui-images/img-20260611000200-beef.png',
                          mimeType: 'image/png'
                        }],
                        endpoint: 'generations'
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '图片已生成。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '帮我画一张猫的图片',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_img',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '图片已生成。' })
      expect(parsed.files).toEqual([
        {
          path: realImagePath,
          relativePath: '.deepseekgui-images/img-20260611000200-beef.png',
          fileName: 'img-20260611000200-beef.png'
        }
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns current-turn generated music files in the WeChat webhook reply for follow-up prompts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-music-'))
    const mediaDir = join(workspaceRoot, '.deepseekgui-media')
    const musicPath = join(mediaDir, 'music-20260612054704-78a2.mp3')
    await mkdir(mediaDir, { recursive: true })
    await writeFile(musicPath, Buffer.from([0x49, 0x44, 0x33, 0x03]))
    const realMusicPath = await realpath(musicPath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.musicGeneration = {
        enabled: true,
        providerId: '',
        protocol: 'minimax-music',
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-music',
        model: 'music-2.6',
        format: 'mp3',
        timeoutMs: 300000
      }
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx_music',
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx_music',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx_music/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expect(body.prompt).toContain('欢快的人声')
          expect(body.prompt).toContain('generate_music')
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_music' }) }
        }
        if (path === '/v1/threads/thr_wx_music' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx_music',
              status: 'idle',
              turns: [
                {
                  id: 'turn_wx_music',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_music',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: musicPath,
                          relativePath: '.deepseekgui-media/music-20260612054704-78a2.mp3',
                          mimeType: 'audio/mpeg'
                        }]
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '欢快的人声歌曲已生成～' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '欢快的人声',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_music',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '欢快的人声歌曲已生成～' })
      expect(parsed.files).toEqual([
        {
          path: realMusicPath,
          relativePath: '.deepseekgui-media/music-20260612054704-78a2.mp3',
          fileName: 'music-20260612054704-78a2.mp3'
        }
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('does not return files from previous turns when the current IM turn produces none', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-stale-files-'))
    const imageDir = join(workspaceRoot, '.deepseekgui-images')
    const imagePath = join(imageDir, 'img-20260611000300-cafe.png')
    await mkdir(imageDir, { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.imageGeneration = {
        enabled: true,
        providerId: '',
        protocol: 'openai-images',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'sk-image',
        model: 'test-image-model',
        defaultSize: '1024x1024',
        timeoutMs: 180000
      }
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx_stale',
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx_stale',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx_stale/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expect(body.prompt).toContain('generate_image')
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
        }
        if (path === '/v1/threads/thr_wx_stale' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx_stale',
              status: 'idle',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_image',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: imagePath,
                          relativePath: '.deepseekgui-images/img-20260611000300-cafe.png',
                          mimeType: 'image/png'
                        }]
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '上一张图片。' }
                  ]
                },
                {
                  id: 'turn_current',
                  status: 'completed',
                  items: [
                    { kind: 'assistant_text', text: '这次没有生成新文件。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '帮我生成一张图片',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_stale',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '这次没有生成新文件。' })
      expect(parsed.files).toEqual([])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns generated speech files in the WeChat webhook reply for voice requests', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-speech-'))
    const speechDir = join(workspaceRoot, '.deepseekgui-media')
    const speechPath = join(speechDir, 'speech-20260612000100-feed.mp3')
    await mkdir(speechDir, { recursive: true })
    await writeFile(speechPath, Buffer.from([0x49, 0x44, 0x33, 0x03]))
    const realSpeechPath = await realpath(speechPath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.textToSpeech = {
        enabled: true,
        providerId: '',
        protocol: 'minimax-t2a',
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-speech',
        model: 'speech-2.8-hd',
        voice: '',
        format: 'mp3',
        timeoutMs: 120000
      }
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx_speech',
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx_speech',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx_speech/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expect(body.prompt).toContain('generate_speech')
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_speech' }) }
        }
        if (path === '/v1/threads/thr_wx_speech' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx_speech',
              status: 'idle',
              turns: [
                {
                  id: 'turn_wx_speech',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_speech',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: speechPath,
                          relativePath: '.deepseekgui-media/speech-20260612000100-feed.mp3',
                          mimeType: 'audio/mpeg'
                        }]
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '语音已生成。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '帮我生成一段语音旁白',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_speech',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '语音已生成。' })
      expect(parsed.files).toEqual([
        {
          path: realSpeechPath,
          relativePath: '.deepseekgui-media/speech-20260612000100-feed.mp3',
          fileName: 'speech-20260612000100-feed.mp3'
        }
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns current-turn generated video files in the WeChat webhook reply for follow-up prompts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-video-'))
    const mediaDir = join(workspaceRoot, '.deepseekgui-media')
    const videoPath = join(mediaDir, 'video-20260612061000-c0de.mp4')
    await mkdir(mediaDir, { recursive: true })
    await writeFile(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))
    const realVideoPath = await realpath(videoPath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.videoGeneration = {
        enabled: true,
        providerId: '',
        protocol: 'minimax-video',
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-video',
        model: 'MiniMax-Hailuo-2.3',
        defaultDuration: 6,
        defaultResolution: '1080P',
        timeoutMs: 900000,
        pollIntervalMs: 10000
      }
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx_video',
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx_video',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx_video/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expect(body.prompt).toContain('16:9')
          expect(body.prompt).toContain('generate_video')
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_video' }) }
        }
        if (path === '/v1/threads/thr_wx_video' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx_video',
              status: 'idle',
              turns: [
                {
                  id: 'turn_wx_video',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_video',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: videoPath,
                          relativePath: '.deepseekgui-media/video-20260612061000-c0de.mp4',
                          mimeType: 'video/mp4'
                        }]
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '视频已生成。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '16:9',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_video',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '视频已生成。' })
      expect(parsed.files).toEqual([
        {
          path: realVideoPath,
          relativePath: '.deepseekgui-media/video-20260612061000-c0de.mp4',
          fileName: 'video-20260612061000-c0de.mp4'
        }
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('sends agent reply containing markdown as Feishu / Lark markdown', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const markdownReply = '**bold** `code`\n- item 1\n- item 2'
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_md' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            turns: [
              {
                id: 'turn_md',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: markdownReply }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const send = vi.fn(async () => ({ messageId: 'om_md' }))
    const addReaction = vi.fn(async () => 'rc_test_1')
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'tell me a story',
      rawContentType: 'text',
      mentions: []
    })

    // The pending reaction is added on the user's inbound message BEFORE
    // the agent reply is sent.
    expect(addReaction).toHaveBeenCalledWith('om_inbound', 'OnIt')
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: markdownReply },
      { replyTo: 'om_inbound', replyInThread: false }
    )
    const textFormCall = (send.mock.calls as unknown as Array<[string, Record<string, unknown>]>)
      .find(([, input]) => typeof input?.text === 'string')
    expect(textFormCall).toBeUndefined()
  })

  it('falls back to markdown form when retrying without replyTo', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError
    })

    const result = await (runtime as unknown as {
      sendFeishuMessage: (
        bridge: { send: typeof send },
        to: string,
        input: { markdown: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: undefined, replyInThread: undefined }
    )
  })

  it('continues agent flow when pending reaction add fails', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const logError = vi.fn()
    const agentReply = 'all good'
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_react_fail' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            turns: [
              {
                id: 'turn_react_fail',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: agentReply }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const addReaction = vi.fn().mockRejectedValue(new Error('addReaction API error'))
    const send = vi.fn(async () => ({ messageId: 'om_agent_after_react_fail' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_react_fail',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'do something',
      rawContentType: 'text',
      mentions: []
    })

    // The pending reaction failure must be logged and swallowed.
    expect(logError).toHaveBeenCalledWith(
      'claw-feishu',
      expect.stringContaining('pending reaction'),
      expect.objectContaining({
        message: 'addReaction API error',
        chatId: 'oc_chat_a',
        messageId: 'om_inbound_react_fail'
      })
    )
    // The agent reply is still dispatched despite the reaction failure.
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: agentReply },
      { replyTo: 'om_inbound_react_fail', replyInThread: false }
    )
  })

  it('does not add a pending reaction for IM commands', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel()]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const send = vi.fn(async () => ({ messageId: 'om_cmd' }))
    const addReaction = vi.fn(async () => 'rc_cmd_1')
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_cmd',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/help',
      rawContentType: 'text',
      mentions: []
    })

    // /help produces a single IM command reply; no pending reaction.
    expect(send).toHaveBeenCalledTimes(1)
    expect(addReaction).not.toHaveBeenCalled()
  })
})
