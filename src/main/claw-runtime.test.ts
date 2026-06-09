import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defaultClawSettings,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImConversationV1
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
    guiUpdate: { channel: 'stable' }
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
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
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
        input: { text: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { text: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { text: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { text: 'agent reply' },
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
      { text: 'Started a new topic. The next message will create a fresh local conversation.' },
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
      { text: 'Claw IM model switched to `deepseek-v4-flash`.' },
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
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
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
        content: '发给我',
        rawContentType: 'text',
        mentions: []
      })

      expect(send).toHaveBeenNthCalledWith(
        1,
        'oc_chat_a',
        { text: '可以，我把 hello.md 作为附件发给你。' },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      expect(send).toHaveBeenNthCalledWith(
        2,
        'oc_chat_a',
        { file: { source: realFilePath, fileName: 'hello.md' } },
        { replyTo: 'om_inbound', replyInThread: false }
      )
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
