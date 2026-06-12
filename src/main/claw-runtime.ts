import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { URL } from 'node:url'
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
  type NormalizedMessage,
  type SendInput,
  type SendOptions,
  type SendResult
} from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  ClawGeneratedFileV1,
  ClawImFeishuPlatformCredentialV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawModel,
  ClawImProvider,
  ClawImRemoteSessionV1,
  ClawRunResult,
  ClawRuntimeStatus
} from '../shared/app-settings'
import {
  CLAW_MODEL_IDS,
  DEFAULT_CLAW_MODEL,
  buildClawRuntimePrompt,
  parseClawUserPromptForDisplay
} from '../shared/app-settings'
import { parseClawCommand } from '../shared/claw-commands'
import {
  asString,
  buildFeishuPrompt,
  clawConversationKey,
  extractIncomingChannelId,
  extractIncomingProvider,
  extractIncomingPrompt,
  extractIncomingRemoteSession,
  extractSenderLabel,
  feishuSenderLabel,
  formatFeishuMirrorText,
  isRunningStatus,
  latestGeneratedFiles,
  latestAssistantText,
  nestedRecord,
  normalizeTaskModel,
  parseJsonObject,
  readRequestBody,
  replyTextForGeneratedFiles,
  runtimeErrorMessage,
  sanitizePathSegment,
  shouldDirectSendExistingGeneratedFilesForPrompt,
  shouldSendGeneratedFilesForPrompt,
  sleep,
  subscribeRuntimeThreadEvents,
  webhookUrl,
  writeJson,
  type ClawRuntimeDeps,
  type RunPromptOptions,
  type SseSubscriber,
  type ThreadDetailJson,
  type ThreadRecordJson
} from './claw-runtime-helpers'
import { getRuntimeBaseUrlForSettings, runtimeAuthHeaders } from './runtime/kun-adapter'
import { FeishuStreamer } from './feishu-streamer'

const MAX_FEISHU_FILE_UPLOAD_BYTES = 50 * 1024 * 1024
const CLAW_IM_APPROVAL_POLICY = 'auto'
const CLAW_IM_SANDBOX_MODE = 'danger-full-access'

type FeishuClawChannel = ClawImChannelV1 & {
  platformCredential: ClawImFeishuPlatformCredentialV1
}

function hasFeishuPlatformCredential(channel: ClawImChannelV1): channel is FeishuClawChannel {
  return channel.platformCredential?.kind === 'feishu' &&
    !!channel.platformCredential.appId.trim() &&
    !!channel.platformCredential.appSecret.trim()
}

function isMissingThreadResult(result: { ok: boolean; status: number; body: string }): boolean {
  if (result.ok) return false
  const message = runtimeErrorMessage(result, '').toLowerCase()
  return result.status === 404 && message.includes('thread') && message.includes('not found')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isChineseLocale(settings: AppSettingsV1): boolean {
  return settings.locale.toLowerCase().startsWith('zh')
}

function currentImModel(settings: AppSettingsV1, channel?: ClawImChannelV1): string {
  return channel?.model?.trim() || settings.claw.im.model.trim() || DEFAULT_CLAW_MODEL
}

function imCommandHelpText(settings: AppSettingsV1): string {
  if (isChineseLocale(settings)) {
    return [
      'Claw IM 命令：',
      '- `/help`：查看命令帮助',
      '- `/new`：当前 IM 连接开启新话题',
      '- `/model`：查看当前模型',
      '- `/model auto|pro|flash`：切换当前 IM 连接模型',
      '也支持 `-new`、`-help`、`-model flash` 这种写法。'
    ].join('\n')
  }
  return [
    'Claw IM commands:',
    '- `/help`: show command help',
    '- `/new`: start a new topic for this IM connection',
    '- `/model`: show the current model',
    '- `/model auto|pro|flash`: switch this IM connection model',
    '`-new`, `-help`, and `-model flash` are supported too.'
  ].join('\n')
}

function imModelCommandHint(settings: AppSettingsV1): string {
  const ids = CLAW_MODEL_IDS.join(', ')
  return isChineseLocale(settings)
    ? `可使用 /model auto、/model pro 或 /model flash。可用模型：${ids}。`
    : `Use /model auto, /model pro, or /model flash. Available models: ${ids}.`
}

function imModelCurrentText(settings: AppSettingsV1, model: string): string {
  return isChineseLocale(settings)
    ? `当前 Claw IM 模型是 \`${model}\`。`
    : `Current Claw IM model: \`${model}\`.`
}

function imModelChangedText(settings: AppSettingsV1, model: string): string {
  return isChineseLocale(settings)
    ? `Claw IM 模型已切换到 \`${model}\`。`
    : `Claw IM model switched to \`${model}\`.`
}

function imNewTopicText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '新话题已开启。下一条消息会创建新的本地会话。'
    : 'Started a new topic. The next message will create a fresh local conversation.'
}

/**
 * One-time intro sent to an IM conversation when the channel is first
 * connected: who the assistant is, what it can do, and the IM commands.
 */
export function imWelcomeText(settings: AppSettingsV1, channel?: ClawImChannelV1): string {
  const profile = channel?.agentProfile
  const name = profile?.name.trim() || channel?.label.trim() || 'DeepSeek GUI'
  const description = profile?.description.trim() ?? ''
  if (isChineseLocale(settings)) {
    return [
      `你好，我是 ${name}，通过 DeepSeek GUI 连接到这个对话的 AI 助手。`,
      ...(description ? [description] : []),
      '你可以直接发消息让我帮忙：回答问题、查资料、读写已连接电脑工作区里的文件、生成文档等，完成后我会在这里回复你。',
      imCommandHelpText(settings),
      '直接发一条消息就可以开始。'
    ].join('\n\n')
  }
  return [
    `Hi, I am ${name}, an AI assistant connected to this chat through DeepSeek GUI.`,
    ...(description ? [description] : []),
    'Send me a message and I will handle it on the connected computer: answering questions, research, reading and writing workspace files, generating documents — I reply here once done.',
    imCommandHelpText(settings),
    'Send any message to get started.'
  ].join('\n\n')
}

export class ClawRuntime {
  private readonly deps: ClawRuntimeDeps
  private server: Server | null = null
  private serverKey = ''
  private feishuChannels = new Map<string, LarkChannel>()
  private feishuChannelKeys = new Map<string, string>()
  private feishuSyncVersion = 0
  /** Channels with an in-flight first-message welcome delivery. */
  private readonly welcomeInFlight = new Set<string>()
  /** WeChat channels already greeted (or attempted) at connect time this run. */
  private readonly weixinConnectWelcomeAttempted = new Set<string>()

  constructor(deps: ClawRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.syncWebhook(settings)
    void this.syncFeishuChannels(settings)
    void this.syncWeixinConnectWelcomes(settings)
  }

  /**
   * Greets the WeChat owner right after a channel is first connected.
   * The QR login records the owner's user id, so the intro can be
   * pushed before any inbound message. Failures fall back to the
   * first-inbound-message welcome.
   */
  private async syncWeixinConnectWelcomes(settings: AppSettingsV1): Promise<void> {
    if (!settings.claw.enabled || !settings.claw.im.enabled) return
    if (!this.deps.sendWeixinBridgeMessage || !this.deps.resolveWeixinAccountUserId) return
    for (const channel of settings.claw.channels) {
      if (!channel.enabled || channel.provider !== 'weixin' || channel.welcomeSentAt) continue
      const credential = channel.platformCredential
      if (credential?.kind !== 'weixin' || !credential.accountId.trim()) continue
      if (this.weixinConnectWelcomeAttempted.has(channel.id) || this.welcomeInFlight.has(channel.id)) continue
      this.weixinConnectWelcomeAttempted.add(channel.id)
      this.welcomeInFlight.add(channel.id)
      try {
        const owner = (await this.deps.resolveWeixinAccountUserId(credential.accountId)).trim()
        if (!owner) continue
        const result = await this.deps.sendWeixinBridgeMessage({
          accountId: credential.accountId,
          to: owner,
          text: imWelcomeText(settings, channel)
        })
        if (result.ok) {
          await this.markChannelWelcomeSent(channel.id)
        } else {
          this.deps.logError('claw-weixin', 'Failed to greet the WeChat owner after connect; the welcome will be sent on the first inbound message instead.', {
            channelId: channel.id,
            message: result.message
          })
        }
      } catch (error) {
        this.deps.logError('claw-weixin', 'Failed to greet the WeChat owner after connect', {
          channelId: channel.id,
          message: errorMessage(error)
        })
      } finally {
        this.welcomeInFlight.delete(channel.id)
      }
    }
  }

  private async markChannelWelcomeSent(channelId: string): Promise<void> {
    const settings = await this.deps.store.load()
    const now = new Date().toISOString()
    await this.deps.store.patch({
      claw: {
        channels: settings.claw.channels.map((item) =>
          item.id === channelId ? { ...item, welcomeSentAt: now, updatedAt: now } : item
        )
      }
    })
  }

  /** Welcome text still owed to this channel, or '' when already delivered. */
  private pendingWelcomeText(settings: AppSettingsV1, channel: ClawImChannelV1 | undefined): string {
    if (!channel || channel.welcomeSentAt || this.welcomeInFlight.has(channel.id)) return ''
    return imWelcomeText(settings, channel)
  }

  /**
   * Sends the welcome as its own WeChat bubble so it arrives ahead of
   * the (slow) model reply. Returns false when the channel cannot push
   * (non-WeChat provider, missing bridge, unknown recipient) so the
   * caller falls back to prepending the text to the HTTP reply.
   */
  private async pushWeixinWelcome(
    channel: ClawImChannelV1,
    remoteSession: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'> | undefined,
    text: string
  ): Promise<boolean> {
    if (channel.provider !== 'weixin' || !this.deps.sendWeixinBridgeMessage) return false
    const credential = channel.platformCredential
    if (credential?.kind !== 'weixin' || !credential.accountId.trim()) return false
    const to = remoteSession?.chatId.trim() || channel.remoteSession?.chatId.trim() || ''
    if (!to) return false
    const result = await this.deps.sendWeixinBridgeMessage({
      accountId: credential.accountId,
      to,
      text
    })
    if (!result.ok) {
      this.deps.logError('claw-weixin', 'Failed to push the WeChat welcome message; prepending it to the reply instead.', {
        channelId: channel.id,
        message: result.message
      })
    }
    return result.ok
  }

  stop(): void {
    this.closeWebhook()
    void this.closeAllFeishuChannels()
  }

  async status(): Promise<ClawRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      imServerRunning: this.server !== null && settings.claw.enabled && settings.claw.im.enabled,
      imUrl: webhookUrl(settings),
      runningTaskIds: []
    }
  }

  async runTask(_taskId: string): Promise<ClawRunResult> {
    return { ok: false, message: 'Claw scheduled tasks have moved to Schedule.' }
  }

  private async runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ClawRunResult> {
    const workspace = options.workspaceRoot.trim() || settings.workspaceRoot
    const existingThreadId = options.threadId?.trim()
    const model = normalizeTaskModel(options.model) ?? (settings.agents.kun.model.trim() || DEFAULT_CLAW_MODEL)
    const createThread = async (): Promise<ThreadRecordJson | null> => {
      const body: Record<string, unknown> = { workspace, model, mode: options.mode }
      if (options.source === 'im') {
        body.approvalPolicy = CLAW_IM_APPROVAL_POLICY
        body.sandboxMode = CLAW_IM_SANDBOX_MODE
      }
      const create = await this.deps.runtimeRequest(settings, '/v1/threads', {
        method: 'POST',
        body: JSON.stringify(body)
      })
      if (!create.ok) return null
      return JSON.parse(create.body) as ThreadRecordJson
    }
    const patchThreadTitle = (thread: ThreadRecordJson): void => {
      if (!options.title.trim()) return
      void this.deps.runtimeRequest(settings, `/v1/threads/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: options.title.trim() })
      })
    }
    let thread: ThreadRecordJson | null = existingThreadId ? { id: existingThreadId } : await createThread()
    if (!thread) return { ok: false, message: 'Failed to create thread.' }
    if (!existingThreadId) patchThreadTitle(thread)

    const runtimePrompt = buildClawRuntimePrompt(settings, options.prompt, { channel: options.channel })
    const displayText = options.displayText?.trim() || parseClawUserPromptForDisplay(options.prompt).text
    const turnBody: Record<string, unknown> = {
      prompt: runtimePrompt,
      mode: options.mode
    }
    if (displayText && displayText !== runtimePrompt) turnBody.displayText = displayText
    if (model) turnBody.model = model
    // IM senders can only reply in their chat app; they cannot answer
    // GUI prompts, so the runtime must not expose user-input tools.
    if (options.source === 'im') {
      turnBody.disableUserInput = true
      turnBody.approvalPolicy = CLAW_IM_APPROVAL_POLICY
      turnBody.sandboxMode = CLAW_IM_SANDBOX_MODE
    }
    let turn = await this.startRuntimeTurn(settings, thread.id, turnBody)
    if (!turn.ok && existingThreadId && isMissingThreadResult(turn)) {
      this.deps.logError('claw-runtime', 'Configured IM thread was missing; creating a replacement thread.', {
        threadId: existingThreadId,
        channelId: options.channel?.id,
        source: options.source
      })
      thread = await createThread()
      if (!thread) return { ok: false, message: 'Failed to create thread.' }
      patchThreadTitle(thread)
      turn = await this.startRuntimeTurn(settings, thread.id, turnBody)
    }
    if (!turn.ok) return { ok: false, message: runtimeErrorMessage(turn, 'Failed to start turn.') }

    const parsedTurn = parseJsonObject(turn.body)
    const turnId = asString(parsedTurn?.turnId) || asString(nestedRecord(parsedTurn?.turn).id)
    if (!turnId) {
      return { ok: false, message: 'Failed to start turn: missing turn id.' }
    }
    if (turnId && options.onTurnStarted) {
      await options.onTurnStarted({ threadId: thread.id, turnId })
    }
    if (!options.waitForResult) {
      return { ok: true, threadId: thread.id, turnId, message: 'Started' }
    }

    const result = await this.waitForAssistantResult(settings, thread.id, turnId, options.responseTimeoutMs, workspace)
    return {
      ok: true,
      threadId: thread.id,
      turnId,
      text: result.text,
      message: result.text || 'Completed',
      files: result.files
    }
  }

  private async subscribeSse(
    settings: AppSettingsV1,
    threadId: string,
    streamer: FeishuStreamer,
    signal: AbortSignal
  ): Promise<{ close: () => void }> {
    const baseUrl = getRuntimeBaseUrlForSettings(settings)
    if (!baseUrl) throw new Error('runtime_base_url_unavailable')
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    const auth = runtimeAuthHeaders(settings).get('Authorization')
    if (auth) headers.Authorization = auth
    const onEvent = (event: { kind?: string; [k: string]: unknown }): void => {
      streamer.onSseEvent(event as Record<string, unknown>)
    }
    return subscribeRuntimeThreadEvents({
      baseUrl,
      threadId,
      headers,
      onEvent,
      signal,
      logError: (category, message, detail) => this.deps.logError(category, message, detail)
    })
  }

  private subscribeSseForStreamer(
    settings: AppSettingsV1,
    threadId: string,
    streamer: FeishuStreamer
  ): SseSubscriber {
    return (signal) => {
      if (signal.aborted) {
        // Caller already aborted; don't kick off the async setup (it would
        // attach an abort listener to an already-aborted signal and proceed
        // to fetch anyway, leaking the connection).
        return { close: () => undefined }
      }
      // `subscribeRuntimeThreadEvents` is async, but the SseSubscriber
      // contract is synchronous (returns a `{ close }` handle). Kick off
      // the async subscription and surface its `close` synchronously by
      // racing the setup; on setup rejection we abort the streamer so the
      // producer breaks out of `await nextDelta()` and the fallback path
      // can run instead of hanging forever.
      const setup = this.subscribeSse(settings, threadId, streamer, signal)
      let close: () => void = () => undefined
      void setup.then(
        (handle) => { close = handle.close },
        (error) => {
          this.deps.logError('claw-feishu-stream', 'SSE subscription setup failed', {
            message: error instanceof Error ? error.message : String(error),
            threadId
          })
          // Wake the streamer so the runStreamingReply fallback path can run
          // instead of hanging in await nextDelta() forever.
          streamer.abort()
        }
      )
      return { close: () => close() }
    }
  }

  private async runStreamingReply(input: {
    bridge: LarkChannel
    chatId: string
    threadId: string
    turnId: string
    replyOptions: { replyTo?: string; replyInThread?: boolean }
    responseTimeoutMs: number
    context: Record<string, unknown>
  }): Promise<{ ok: boolean; messageId: string; finalText: string; fellBack: boolean; message: string }> {
    const cancel = new AbortController()
    const timeout = setTimeout(() => cancel.abort(), input.responseTimeoutMs)
    const streamer = new FeishuStreamer({
      bridge: input.bridge,
      chatId: input.chatId,
      turnId: input.turnId,
      threadId: input.threadId,
      replyOptions: input.replyOptions,
      logger: (category, message, detail) => this.deps.logError(category, message, detail)
    })
    try {
      const settings = await this.deps.store.load()
      const result = await streamer.start({
        subscribe: this.subscribeSseForStreamer(settings, input.threadId, streamer)
      })
      return {
        ok: result.ok,
        messageId: result.messageId,
        finalText: result.finalText,
        fellBack: result.fellBack,
        message: result.ok ? 'streamed' : 'stream_failed'
      }
    } catch (error) {
      this.deps.logError('claw-feishu-stream', 'Streaming reply failed; falling back to one-shot send.', {
        message: error instanceof Error ? error.message : String(error),
        ...input.context
      })
      const finalText = streamer.getAccumulatedText() || ''
      try {
        const fb = await input.bridge.send(
          input.chatId,
          { markdown: finalText || 'Sorry, I could not finish streaming the response.' },
          input.replyOptions
        )
        return { ok: true, messageId: fb.messageId, finalText, fellBack: true, message: 'fell_back' }
      } catch (fbError) {
        return {
          ok: false,
          messageId: '',
          finalText,
          fellBack: true,
          message: fbError instanceof Error ? fbError.message : String(fbError)
        }
      }
    } finally {
      clearTimeout(timeout)
      streamer.dispose()
    }
  }

  private startRuntimeTurn(
    settings: AppSettingsV1,
    threadId: string,
    turnBody: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; body: string }> {
    return this.deps.runtimeRequest(
      settings,
      `/v1/threads/${encodeURIComponent(threadId)}/turns`,
      { method: 'POST', body: JSON.stringify(turnBody) }
    )
  }

  private async waitForAssistantResult(
    settings: AppSettingsV1,
    threadId: string,
    turnId: string,
    timeoutMs: number,
    workspaceRoot?: string
  ): Promise<{ text: string; files: ClawGeneratedFileV1[] }> {
    const deadline = Date.now() + timeoutMs
    let lastText = ''
    let lastDetail: ThreadDetailJson | null = null
    while (Date.now() < deadline) {
      await sleep(1_500)
      const detailRes = await this.deps.runtimeRequest(
        settings,
        `/v1/threads/${encodeURIComponent(threadId)}`,
        { method: 'GET' }
      )
      if (!detailRes.ok) {
        throw new Error(runtimeErrorMessage(detailRes, 'Failed to read thread result.'))
      }
      const detail = JSON.parse(detailRes.body) as ThreadDetailJson
      lastDetail = detail
      lastText = latestAssistantText(detail, { turnId }) || lastText
      const targetTurn = Array.isArray(detail.turns)
        ? detail.turns.find((turn) => turn.id === turnId)
        : undefined
      if (!targetTurn) continue
      if (isRunningStatus(targetTurn.status)) continue
      if (targetTurn.status === 'failed' || targetTurn.status === 'aborted') {
        const error = targetTurn.error?.trim()
        throw new Error(error || `Agent turn ${targetTurn.status}.`)
      }
      if (targetTurn.status === 'completed' && lastText) {
        return {
          text: lastText,
          files: latestGeneratedFiles(detail, { turnId, workspaceRoot })
        }
      }
    }
    if (lastText && lastDetail) {
      return {
        text: lastText,
        files: latestGeneratedFiles(lastDetail, { turnId, workspaceRoot })
      }
    }
    throw new Error('Timed out waiting for agent response.')
  }

  private resolveChannelWorkspaceRoot(settings: AppSettingsV1, channel?: ClawImChannelV1): string {
    return channel?.workspaceRoot.trim() || settings.claw.im.workspaceRoot.trim() || settings.workspaceRoot
  }

  private legacyEmptyBaseConversationWorkspaceRoot(
    session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
  ): string {
    const key = sanitizePathSegment(session.threadId.trim() || session.chatId.trim(), 'conversation')
    return `/conversations/${key}`
  }

  private resolveConversationWorkspaceRoot(
    settings: AppSettingsV1,
    channel: ClawImChannelV1,
    session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
  ): string {
    const base = this.resolveChannelWorkspaceRoot(settings, channel).trim()
    const key = sanitizePathSegment(session.threadId.trim() || session.chatId.trim(), 'conversation')
    return base ? `${base.replace(/\/+$/, '')}/conversations/${key}` : ''
  }

  private resolveIncomingWorkspaceRoot(
    settings: AppSettingsV1,
    channel: ClawImChannelV1 | undefined,
    conversation: ClawImConversationV1 | undefined,
    remoteSession: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'> | undefined
  ): string {
    const storedConversationRoot = conversation?.workspaceRoot.trim() ?? ''
    if (storedConversationRoot && remoteSession) {
      const legacyEmptyBaseRoot = this.legacyEmptyBaseConversationWorkspaceRoot(remoteSession)
      if (storedConversationRoot !== legacyEmptyBaseRoot) return storedConversationRoot
    } else if (storedConversationRoot) {
      return storedConversationRoot
    }
    const conversationRoot = channel && remoteSession
      ? this.resolveConversationWorkspaceRoot(settings, channel, remoteSession)
      : ''
    return conversationRoot || this.resolveChannelWorkspaceRoot(settings, channel)
  }

  private findChannelConversation(
    channel: ClawImChannelV1,
    session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
  ): ClawImConversationV1 | undefined {
    const targetKey = clawConversationKey(session.chatId, session.threadId)
    return channel.conversations.find((conversation) =>
      clawConversationKey(conversation.chatId, conversation.remoteThreadId) === targetKey
    )
  }

  private async resetIncomingImThread(
    input: {
      channel?: ClawImChannelV1
      conversation?: ClawImConversationV1
      remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<void> {
    if (!input.channel) return
    const currentSettings = await this.deps.store.load()
    const currentChannel = currentSettings.claw.channels.find((item) => item.id === input.channel?.id)
    if (!currentChannel) return
    const session = input.remoteSession
    const currentConversation = session
      ? this.findChannelConversation(currentChannel, session)
      : input.conversation
        ? currentChannel.conversations.find((item) => item.id === input.conversation?.id)
        : undefined
    const now = new Date().toISOString()
    await this.deps.store.patch({
      claw: {
        channels: currentSettings.claw.channels.map((item) => {
          if (item.id !== currentChannel.id) return item
          return {
            ...item,
            threadId: '',
            conversations: currentConversation
              ? item.conversations.map((conversation) =>
                  conversation.id === currentConversation.id
                    ? {
                        ...conversation,
                        latestMessageId: session?.messageId || conversation.latestMessageId,
                        senderId: session?.senderId || conversation.senderId,
                        senderName: session?.senderName || conversation.senderName,
                        localThreadId: '',
                        updatedAt: now
                      }
                    : conversation
                )
              : item.conversations,
            updatedAt: now
          }
        })
      }
    })
  }

  private async setIncomingImModel(channel: ClawImChannelV1 | undefined, model: ClawModel): Promise<void> {
    if (!channel) {
      await this.deps.store.patch({ claw: { im: { model } } })
      return
    }
    const currentSettings = await this.deps.store.load()
    const now = new Date().toISOString()
    await this.deps.store.patch({
      claw: {
        channels: currentSettings.claw.channels.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                model,
                updatedAt: now
              }
            : item
        )
      }
    })
  }

  private async handleIncomingImCommand(
    settings: AppSettingsV1,
    input: {
      text: string
      channel?: ClawImChannelV1
      conversation?: ClawImConversationV1
      remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<string | null> {
    const command = parseClawCommand(input.text)
    if (!command) return null
    if (command.kind === 'help') return imCommandHelpText(settings)
    if (command.kind === 'showModel') return imModelCurrentText(settings, currentImModel(settings, input.channel))
    if (command.kind === 'invalidModel') return imModelCommandHint(settings)
    if (command.kind === 'model') {
      await this.setIncomingImModel(input.channel, command.model)
      return imModelChangedText(settings, command.model)
    }
    if (command.kind === 'clear') {
      await this.resetIncomingImThread({
        channel: input.channel,
        conversation: input.conversation,
        remoteSession: input.remoteSession
      })
      return imNewTopicText(settings)
    }
    return null
  }

  private async processIncomingImPrompt(
    settings: AppSettingsV1,
    input: {
      prompt: string
      sender: string
      provider: ClawImProvider
      channel?: ClawImChannelV1
      conversation?: ClawImConversationV1
      remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
    }
  ): Promise<ClawRunResult> {
    const { channel, conversation, prompt, provider, remoteSession, sender } = input
    const initialThreadId =
      conversation?.localThreadId.trim() ||
      channel?.threadId.trim() ||
      ''
    const result = await this.runPrompt(settings, {
      prompt,
      title: channel ? `[Claw IM:${channel.label}] ${sender}` : `[Claw IM:${provider}] ${sender}`,
      workspaceRoot: this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession),
      model: channel?.model ?? settings.claw.im.model,
      mode: settings.claw.im.mode,
      waitForResult: true,
      responseTimeoutMs: settings.claw.im.responseTimeoutMs,
      source: 'im',
      threadId: initialThreadId || undefined,
      channel,
      onTurnStarted: async ({ threadId }) => {
        if (!channel) return
        const now = new Date().toISOString()
        // Patch from a fresh settings snapshot: the request-scoped
        // `settings` may be stale by now (e.g. the welcome marker was
        // persisted while this turn was starting).
        const latestSettings = await this.deps.store.load()
        if (remoteSession) {
          const existingConversation = conversation ?? this.findChannelConversation(channel, remoteSession)
          const nextConversation: ClawImConversationV1 = existingConversation
            ? {
                ...existingConversation,
                latestMessageId: remoteSession.messageId,
                senderId: remoteSession.senderId,
                senderName: remoteSession.senderName,
                localThreadId: threadId,
                workspaceRoot: this.resolveIncomingWorkspaceRoot(settings, channel, existingConversation, remoteSession),
                updatedAt: now
              }
            : {
                id: randomUUID(),
                chatId: remoteSession.chatId,
                remoteThreadId: remoteSession.threadId,
                latestMessageId: remoteSession.messageId,
                senderId: remoteSession.senderId,
                senderName: remoteSession.senderName,
                localThreadId: threadId,
                workspaceRoot: this.resolveConversationWorkspaceRoot(settings, channel, remoteSession),
                createdAt: now,
                updatedAt: now
              }
          await this.deps.store.patch({
            claw: {
              channels: latestSettings.claw.channels.map((item) =>
                item.id === channel.id
                  ? {
                      ...item,
                      threadId,
                      conversations: existingConversation
                        ? item.conversations.map((entry) => entry.id === existingConversation.id ? nextConversation : entry)
                        : [...item.conversations, nextConversation],
                      updatedAt: now
                    }
                  : item
              )
            }
          })
        } else if (!initialThreadId) {
          await this.deps.store.patch({
            claw: {
              channels: latestSettings.claw.channels.map((item) =>
                item.id === channel.id
                  ? {
                      ...item,
                      threadId,
                      updatedAt: now
                    }
                  : item
              )
            }
          })
        }
        this.deps.notifyChannelActivity?.({ channelId: channel.id, threadId })
      }
    })
    return result
  }

  private resolveFeishuChannels(settings: AppSettingsV1): FeishuClawChannel[] {
    if (!settings.claw.enabled) return []
    return settings.claw.channels.filter(
      (channel): channel is FeishuClawChannel =>
        channel.enabled &&
        channel.provider === 'feishu' &&
        hasFeishuPlatformCredential(channel)
    )
  }

  private buildFeishuRemoteSession(message: NormalizedMessage): ClawImRemoteSessionV1 {
    return {
      chatId: message.chatId.trim(),
      messageId: message.messageId.trim(),
      threadId: message.threadId?.trim() || '',
      senderId: message.senderId.trim(),
      senderName: feishuSenderLabel(message),
      updatedAt: new Date().toISOString()
    }
  }

  private async rememberFeishuRemoteSession(
    settings: AppSettingsV1,
    channel: ClawImChannelV1,
    message:
      | NormalizedMessage
      | Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
  ): Promise<void> {
    const nextRemoteSession =
      'chatType' in message
        ? this.buildFeishuRemoteSession(message)
        : {
            ...message,
            updatedAt: new Date().toISOString()
          }
    const current = channel.remoteSession
    if (
      current?.chatId === nextRemoteSession.chatId &&
      current?.messageId === nextRemoteSession.messageId &&
      current?.threadId === nextRemoteSession.threadId &&
      current?.senderId === nextRemoteSession.senderId &&
      current?.senderName === nextRemoteSession.senderName
    ) {
      return
    }
    await this.deps.store.patch({
      claw: {
        channels: settings.claw.channels.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                remoteSession: nextRemoteSession,
                updatedAt: nextRemoteSession.updatedAt
              }
            : item
        )
      }
    })
  }

  private async sendFeishuMessage(
    bridge: LarkChannel,
    to: string,
    input: SendInput,
    options: SendOptions,
    context: Record<string, unknown>
  ): Promise<SendResult> {
    try {
      return await bridge.send(to, input, options)
    } catch (error) {
      const initialMessage = errorMessage(error)
      if (!options.replyTo) {
        this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark message', {
          ...context,
          message: initialMessage,
          to
        })
        throw error
      }

      this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark reply; falling back to plain chat message.', {
        ...context,
        message: initialMessage,
        replyTo: options.replyTo,
        replyInThread: options.replyInThread,
        to
      })
      try {
        return await bridge.send(to, input, {
          ...options,
          replyTo: undefined,
          replyInThread: undefined
        })
      } catch (fallbackError) {
        this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark fallback message', {
          ...context,
          initialMessage,
          message: errorMessage(fallbackError),
          to
        })
        throw fallbackError
      }
    }
  }

  private async resolveFeishuGeneratedFiles(
    files: readonly ClawGeneratedFileV1[],
    workspaceRoot: string,
    context: Record<string, unknown>
  ): Promise<ClawGeneratedFileV1[]> {
    const root = workspaceRoot.trim()
    if (!root || files.length === 0) return []
    let realRoot = ''
    try {
      realRoot = await realpath(resolve(root))
    } catch (error) {
      this.deps.logError('claw-feishu', 'Failed to resolve Feishu file workspace root', {
        ...context,
        workspaceRoot: root,
        message: errorMessage(error)
      })
      return []
    }

    const resolvedFiles: ClawGeneratedFileV1[] = []
    const seen = new Set<string>()
    for (const file of files) {
      try {
        const realFile = await realpath(resolve(file.path))
        const relativePath = relative(realRoot, realFile)
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
          this.deps.logError('claw-feishu', 'Skipping generated file outside the Feishu workspace', {
            ...context,
            filePath: file.path,
            workspaceRoot: root
          })
          continue
        }
        if (seen.has(realFile)) continue
        const fileStat = await stat(realFile)
        if (!fileStat.isFile()) continue
        if (fileStat.size > MAX_FEISHU_FILE_UPLOAD_BYTES) {
          this.deps.logError('claw-feishu', 'Skipping generated file because it is too large for Feishu upload', {
            ...context,
            filePath: realFile,
            bytes: fileStat.size,
            maxBytes: MAX_FEISHU_FILE_UPLOAD_BYTES
          })
          continue
        }
        seen.add(realFile)
        resolvedFiles.push({
          ...file,
          path: realFile,
          fileName: file.fileName || realFile.split(/[\\/]/).pop() || 'attachment'
        })
      } catch (error) {
        this.deps.logError('claw-feishu', 'Skipping generated file that cannot be read for Feishu upload', {
          ...context,
          filePath: file.path,
          message: errorMessage(error)
        })
      }
    }
    return resolvedFiles
  }

  private async sendFeishuGeneratedFiles(
    bridge: LarkChannel,
    to: string,
    files: readonly ClawGeneratedFileV1[],
    options: SendOptions,
    context: Record<string, unknown>
  ): Promise<{ sent: ClawGeneratedFileV1[]; failed: Array<{ file: ClawGeneratedFileV1; message: string }> }> {
    const sent: ClawGeneratedFileV1[] = []
    const failed: Array<{ file: ClawGeneratedFileV1; message: string }> = []
    for (const file of files) {
      try {
        await this.sendFeishuMessage(
          bridge,
          to,
          { file: { source: file.path, fileName: file.fileName } },
          options,
          {
            ...context,
            purpose: 'agent-file',
            filePath: file.path,
            fileName: file.fileName
          }
        )
        sent.push(file)
      } catch (error) {
        const message = errorMessage(error)
        failed.push({ file, message })
        this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark file attachment', {
          ...context,
          filePath: file.path,
          fileName: file.fileName,
          message
        })
      }
    }
    return { sent, failed }
  }

  private async recentGeneratedFilesForThread(
    settings: AppSettingsV1,
    threadId: string,
    workspaceRoot: string,
    context: Record<string, unknown>
  ): Promise<ClawGeneratedFileV1[]> {
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return []
    try {
      const detailRes = await this.deps.runtimeRequest(
        settings,
        `/v1/threads/${encodeURIComponent(targetThreadId)}`,
        { method: 'GET' }
      )
      if (!detailRes.ok) {
        this.deps.logError('claw-feishu', 'Failed to read recent generated files from Kun thread', {
          ...context,
          threadId: targetThreadId,
          message: runtimeErrorMessage(detailRes, 'Failed to read thread result.')
        })
        return []
      }
      return latestGeneratedFiles(JSON.parse(detailRes.body) as ThreadDetailJson, {
        workspaceRoot,
        maxFiles: 3
      })
    } catch (error) {
      this.deps.logError('claw-feishu', 'Failed to inspect Kun thread for recent generated files', {
        ...context,
        threadId: targetThreadId,
        message: errorMessage(error)
      })
      return []
    }
  }

  private findImChannelForThread(
    settings: AppSettingsV1,
    threadId: string
  ): { channel: ClawImChannelV1; conversation?: ClawImConversationV1 } | null {
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return null
    for (const channel of settings.claw.channels) {
      if (!channel.enabled) continue
      const conversation =
        [...channel.conversations]
          .filter((item) => item.localThreadId.trim() === targetThreadId)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
      if (conversation) return { channel, conversation }
      if (channel.threadId.trim() === targetThreadId) return { channel }
    }
    return null
  }

  private async mirrorThreadMessageToWeixin(
    channel: ClawImChannelV1,
    conversation: ClawImConversationV1 | undefined,
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const credential = channel.platformCredential
    if (credential?.kind !== 'weixin' || !credential.accountId.trim()) {
      return { ok: false, message: 'No target WeChat account is available yet.' }
    }
    const to = conversation?.chatId.trim() || channel.remoteSession?.chatId.trim() || ''
    if (!to) return { ok: false, message: 'No target WeChat conversation is available yet.' }
    if (!this.deps.sendWeixinBridgeMessage) {
      return { ok: false, message: 'Built-in WeChat bridge is not initialized.' }
    }
    const result = await this.deps.sendWeixinBridgeMessage({
      accountId: credential.accountId,
      to,
      text
    })
    if (result.ok) return { ok: true }
    this.deps.logError('claw-weixin', 'Failed to mirror Claw message to WeChat', {
      message: result.message,
      threadId,
      direction,
      channelId: channel.id,
      to
    })
    return result
  }

  async mirrorThreadMessageToIm(
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'Message is empty.' }
    const settings = await this.deps.store.load()
    const target = this.findImChannelForThread(settings, threadId)
    if (!target) return { ok: false, message: 'Channel not found.' }
    if (target.channel.provider === 'weixin') {
      return this.mirrorThreadMessageToWeixin(
        target.channel,
        target.conversation,
        threadId,
        trimmed,
        direction
      )
    }
    if (target.channel.provider !== 'feishu') return { ok: false, message: 'Unsupported IM provider.' }
    const channel = target.channel
    const conversation =
      target.conversation ??
      [...channel.conversations]
        .filter((item) => item.localThreadId.trim() === threadId.trim())
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    if (!conversation?.chatId.trim()) {
      return { ok: false, message: 'No target Feishu / Lark conversation is available yet.' }
    }
    const bridge = this.feishuChannels.get(channel.id)
    if (!bridge) {
      return { ok: false, message: 'Feishu / Lark bridge is not connected.' }
    }
    try {
      await this.sendFeishuMessage(
        bridge,
        conversation.chatId,
        formatFeishuMirrorText(trimmed, direction),
        {},
        {
          purpose: 'mirror',
          threadId,
          direction,
          channelId: channel.id,
          chatId: conversation.chatId
        }
      )
      return { ok: true }
    } catch (error) {
      const message = errorMessage(error)
      this.deps.logError('claw-feishu', 'Failed to mirror Claw message to Feishu / Lark', {
        message,
        threadId,
        direction
      })
      return { ok: false, message }
    }
  }

  async mirrorThreadMessageToFeishu(
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.mirrorThreadMessageToIm(threadId, text, direction)
  }

  private async handleFeishuMessage(channelId: string, message: NormalizedMessage): Promise<void> {
    const bridge = this.feishuChannels.get(channelId)
    const settings = await this.deps.store.load()
    const channel = settings.claw.channels.find((item) => item.id === channelId && item.enabled)
    if (!bridge || !channel) return
    if (bridge.botIdentity?.openId && message.senderId === bridge.botIdentity.openId) return
    if (message.chatType === 'group' && !message.mentionedBot && !message.mentionAll) return
    await this.rememberFeishuRemoteSession(settings, channel, message)
    const remoteSession = this.buildFeishuRemoteSession(message)
    const conversation = this.findChannelConversation(channel, {
      chatId: remoteSession.chatId,
      threadId: remoteSession.threadId
    })
    const workspaceRoot = this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession)
    const replyOptions = { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }

    // Feishu has no recipient until someone messages the bot, so the
    // one-time channel intro goes out before handling the first message.
    const welcomeText = this.pendingWelcomeText(settings, channel)
    if (welcomeText) {
      this.welcomeInFlight.add(channel.id)
      try {
        await this.sendFeishuMessage(
          bridge,
          message.chatId,
          { markdown: welcomeText },
          {},
          {
            purpose: 'welcome',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
        await this.markChannelWelcomeSent(channel.id)
      } catch (error) {
        this.deps.logError('claw-feishu', 'Failed to send the Feishu welcome message; it will be retried on the next inbound message.', {
          message: errorMessage(error),
          channelId,
          chatId: message.chatId
        })
      } finally {
        this.welcomeInFlight.delete(channel.id)
      }
    }

    const commandReply = await this.handleIncomingImCommand(settings, {
      text: message.content,
      channel,
      conversation,
      remoteSession
    })
    if (commandReply !== null) {
      await this.sendFeishuMessage(
        bridge,
        message.chatId,
        { markdown: commandReply },
        replyOptions,
        {
          purpose: 'im-command',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }

    const sender = feishuSenderLabel(message)
    const taskCreation = await this.deps.createScheduledTaskFromText?.(message.content, {
      workspaceRoot: this.resolveChannelWorkspaceRoot(settings, channel),
      modelHint: channel.model,
      mode: settings.claw.im.mode
    }) ?? { kind: 'noop' as const }
    if (taskCreation.kind === 'created') {
      await this.sendFeishuMessage(
        bridge,
        message.chatId,
        { markdown: taskCreation.confirmationText },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
        {
          purpose: 'schedule-created',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }
    if (taskCreation.kind === 'error') {
      await this.sendFeishuMessage(
        bridge,
        message.chatId,
        { markdown: `Failed to create the scheduled task: ${taskCreation.message}` },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
        {
          purpose: 'schedule-error',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId
        }
      )
      return
    }
    if (!message.content.trim() && message.rawContentType !== 'text') {
      try {
        await this.sendFeishuMessage(
          bridge,
          message.chatId,
          { markdown: 'Only text messages are supported right now.' },
          { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
          {
            purpose: 'unsupported-message',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
      } catch (error) {
        this.deps.logError('claw-feishu', 'Failed to send unsupported-message reply', {
          message: errorMessage(error),
          chatId: message.chatId
        })
      }
      return
    }

    if (shouldDirectSendExistingGeneratedFilesForPrompt(message.content)) {
      const existingThreadId = conversation?.localThreadId.trim() || channel.threadId.trim()
      const existingFiles = await this.resolveFeishuGeneratedFiles(
        await this.recentGeneratedFilesForThread(settings, existingThreadId, workspaceRoot, {
          purpose: 'direct-existing-file-lookup',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: existingThreadId
        }),
        workspaceRoot,
        {
          purpose: 'direct-existing-file-resolve',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: existingThreadId
        }
      )
      if (existingFiles.length > 0) {
        try {
          await this.sendFeishuMessage(
            bridge,
            message.chatId,
            { markdown: replyTextForGeneratedFiles('', existingFiles) },
            replyOptions,
            {
              purpose: 'direct-existing-file-reply',
              channelId,
              chatId: message.chatId,
              inboundMessageId: message.messageId,
              threadId: existingThreadId
            }
          )
        } catch (error) {
          this.deps.logError('claw-feishu', 'Failed to send direct file confirmation reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            threadId: existingThreadId
          })
        }
        const delivery = await this.sendFeishuGeneratedFiles(
          bridge,
          message.chatId,
          existingFiles,
          replyOptions,
          {
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: existingThreadId
          }
        )
        if (delivery.sent.length > 0) return
        const failure = delivery.failed[0]?.message || 'unknown upload error'
        await this.sendFeishuMessage(
          bridge,
          message.chatId,
          { markdown: `我找到了文件 ${existingFiles.map((file) => file.fileName).join(', ')}，但飞书附件上传失败：${failure}` },
          replyOptions,
          {
            purpose: 'direct-existing-file-failed',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: existingThreadId
          }
        ).catch((error) => {
          this.deps.logError('claw-feishu', 'Failed to send direct file failure reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            threadId: existingThreadId
          })
        })
        return
      }
    }

    // Add a "in progress" emoji reaction on the user's inbound message
    // immediately so they see feedback before the agent run completes
    // (which can take seconds). The reaction is targeted at the user's
    // message id (not a new bot message) and is left in place after the
    // agent finishes as a "handled" marker.
    //
    // Emoji type selection: Feishu / Lark's `im.v1.messageReaction.create`
    // endpoint accepts a closed set of `emoji_type` strings; the SDK does
    // NOT validate them locally — invalid values are rejected by the API
    // with `code 231001 "reaction type is invalid"`. Empirically verified:
    //   - `'WORK'`  → REJECTED (production logs, code 231001) — never use
    //   - `'OnIt'`  → CONFIRMED VALID — renders as 🫡 (salute face,
    //                 internet-canonical "got it, doing it" signal;
    //                 best match for the user-requested "在做了")
    //   - `'SMILE'` → CONFIRMED VALID — fallback, renders as 🙂
    //
    // Failure is logged but NOT re-thrown — we never want a reaction
    // failure to drop the user's message or abort the agent run.
    try {
      await bridge.addReaction(message.messageId, 'OnIt')
    } catch (error) {
      this.deps.logError('claw-feishu', 'Failed to add Feishu / Lark pending reaction; continuing with the agent run.', {
        message: errorMessage(error),
        chatId: message.chatId,
        messageId: message.messageId
      })
    }

    let result: ClawRunResult
    // Hoisted out of the try so the no-double-send guard (below) can see it.
    const shouldStream = settings.claw.im.feishuStream !== false
    try {
      if (shouldStream) {
        const initialThreadId = conversation?.localThreadId.trim() || channel?.threadId.trim() || ''
        const runResult = await this.runPrompt(settings, {
          prompt: buildFeishuPrompt(message),
          title: channel ? `[Claw IM:${channel.label}] ${sender}` : `[Claw IM:feishu] ${sender}`,
          workspaceRoot: this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession),
          model: channel?.model ?? settings.claw.im.model,
          mode: settings.claw.im.mode,
          waitForResult: false,
          responseTimeoutMs: settings.claw.im.responseTimeoutMs,
          source: 'im',
          threadId: initialThreadId || undefined,
          channel,
          onTurnStarted: async ({ threadId, turnId }) => {
            // Mirror processIncomingImPrompt.onTurnStarted behavior so the
            // streaming path produces the same channel / conversation state
            // as the polling path (mapping persisted, activity notified).
            void turnId
            if (!channel) return
            const now = new Date().toISOString()
            const latestSettings = await this.deps.store.load()
            if (remoteSession) {
              const existingConversation = conversation ?? this.findChannelConversation(channel, remoteSession)
              const nextConversation: ClawImConversationV1 = existingConversation
                ? {
                    ...existingConversation,
                    latestMessageId: remoteSession.messageId,
                    senderId: remoteSession.senderId,
                    senderName: remoteSession.senderName,
                    localThreadId: threadId,
                    workspaceRoot: this.resolveIncomingWorkspaceRoot(latestSettings, channel, existingConversation, remoteSession),
                    updatedAt: now
                  }
                : {
                    id: randomUUID(),
                    chatId: remoteSession.chatId,
                    remoteThreadId: remoteSession.threadId,
                    latestMessageId: remoteSession.messageId,
                    senderId: remoteSession.senderId,
                    senderName: remoteSession.senderName,
                    localThreadId: threadId,
                    workspaceRoot: this.resolveConversationWorkspaceRoot(latestSettings, channel, remoteSession),
                    createdAt: now,
                    updatedAt: now
                  }
              await this.deps.store.patch({
                claw: {
                  channels: latestSettings.claw.channels.map((item) =>
                    item.id === channel.id
                      ? {
                          ...item,
                          threadId,
                          conversations: existingConversation
                            ? item.conversations.map((entry) => entry.id === existingConversation.id ? nextConversation : entry)
                            : [...item.conversations, nextConversation],
                          updatedAt: now
                        }
                      : item
                  )
                }
              })
            } else if (!initialThreadId) {
              await this.deps.store.patch({
                claw: {
                  channels: latestSettings.claw.channels.map((item) =>
                    item.id === channel.id
                      ? {
                          ...item,
                          threadId,
                          updatedAt: now
                        }
                      : item
                  )
                }
              })
            }
            this.deps.notifyChannelActivity?.({ channelId: channel.id, threadId })
          }
        })
        if (runResult.ok && runResult.threadId && runResult.turnId) {
          const stream = await this.runStreamingReply({
            bridge,
            chatId: message.chatId,
            threadId: runResult.threadId,
            turnId: runResult.turnId,
            replyOptions: { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
            responseTimeoutMs: settings.claw.im.responseTimeoutMs,
            context: { channelId, chatId: message.chatId, inboundMessageId: message.messageId, threadId: runResult.threadId, turnId: runResult.turnId }
          })
          // Streaming branch: the SDK already created a streaming card (or
          // runStreamingReply's catch path sent a one-shot fallback). Either
          // way, we MUST NOT resend below. Propagate the finalText as both
          // `text` and `message` so the no-double-send guard can use either,
          // and so any human-readable context (errors, "Sorry" messages)
          // doesn't surface the 'streamed' / 'stream_failed' / 'fell_back'
          // status sentinels returned by runStreamingReply.
          result = {
            ok: stream.ok,
            threadId: runResult.threadId,
            turnId: runResult.turnId,
            text: stream.finalText,
            message: stream.finalText,
            files: []
          }
        } else {
          result = { ok: false, message: runResult.message || 'Failed to start turn.' }
        }
      } else {
        result = await this.processIncomingImPrompt(settings, {
          prompt: buildFeishuPrompt(message),
          sender,
          provider: 'feishu',
          channel,
          conversation,
          remoteSession
        })
      }
    } catch (error) {
      this.deps.logError('claw-feishu', 'Failed to handle Feishu inbound message', {
        message: errorMessage(error),
        chatId: message.chatId,
        senderId: message.senderId
      })
      try {
        await this.sendFeishuMessage(
          bridge,
          message.chatId,
          { markdown: 'Sorry, I could not process your message right now.' },
          { replyTo: message.messageId, replyInThread: Boolean(message.threadId) },
          {
            purpose: 'processing-error',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId
          }
        )
      } catch {
        /* ignore secondary reply failures */
      }
      return
    }

    const filesToSend = result.ok && shouldSendGeneratedFilesForPrompt(message.content)
      ? await this.resolveFeishuGeneratedFiles(result.files ?? [], workspaceRoot, {
          purpose: 'agent-file-resolve',
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: result.threadId,
          turnId: result.turnId
        })
      : []
    const replyText = result.ok
      ? replyTextForGeneratedFiles(result.text?.trim() || 'Completed.', filesToSend)
      : (result.message.trim() || 'Sorry, something went wrong while handling your message.')
    const resultThreadId = result.ok ? result.threadId : undefined
    const resultTurnId = result.ok ? result.turnId : undefined
    // When the streaming branch was used, the SDK already created a streaming
    // card (and runStreamingReply's catch path may have sent a one-shot
    // fallback). Either way, do NOT resend. Use shouldStream (the route taken)
    // rather than result.text.length — text is empty in normal cases where
    // the agent only emits reasoning or tool calls. The previous check
    // `result.text.length > 0` was the bug that produced the "(no content)
    // streamed" double-bubble: every stream had empty text, so the guard
    // always fell through and we sent the 'streamed' status sentinel as a
    // second message.
    if (shouldStream && result.ok) {
      // streaming card (or one-shot fallback) already in chat -- do not resend
    } else {
      try {
        await this.sendFeishuMessage(
          bridge,
          message.chatId,
          { markdown: replyText },
          replyOptions,
          {
            purpose: result.ok ? 'agent-reply' : 'agent-reply-fallback',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            runtimeOk: result.ok,
            threadId: resultThreadId,
            turnId: resultTurnId
          }
        )
      } catch (error) {
        this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark agent reply', {
          message: errorMessage(error),
          chatId: message.chatId,
          senderId: message.senderId,
          threadId: resultThreadId,
          turnId: resultTurnId
        })
      }
    }
    if (filesToSend.length > 0) {
      const delivery = await this.sendFeishuGeneratedFiles(
        bridge,
        message.chatId,
        filesToSend,
        replyOptions,
        {
          channelId,
          chatId: message.chatId,
          inboundMessageId: message.messageId,
          threadId: resultThreadId,
          turnId: resultTurnId
        }
      )
      if (delivery.sent.length === 0 && delivery.failed.length > 0) {
        await this.sendFeishuMessage(
          bridge,
          message.chatId,
          { markdown: `我找到了文件 ${filesToSend.map((file) => file.fileName).join(', ')}，但飞书附件上传失败：${delivery.failed[0]?.message || 'unknown upload error'}` },
          replyOptions,
          {
            purpose: 'agent-file-failed',
            channelId,
            chatId: message.chatId,
            inboundMessageId: message.messageId,
            threadId: resultThreadId,
            turnId: resultTurnId
          }
        ).catch((error) => {
          this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark file failure reply', {
            message: errorMessage(error),
            chatId: message.chatId,
            senderId: message.senderId,
            threadId: resultThreadId,
            turnId: resultTurnId
          })
        })
      }
    }
  }

  private async syncFeishuChannels(settings: AppSettingsV1): Promise<void> {
    const version = ++this.feishuSyncVersion
    const targets = this.resolveFeishuChannels(settings)
    const targetMap = new Map(targets.map((channel) => [channel.id, channel]))

    await Promise.all(
      [...this.feishuChannels.keys()]
        .filter((channelId) => !targetMap.has(channelId))
        .map((channelId) => this.closeFeishuChannel(channelId))
    )
    if (version !== this.feishuSyncVersion) return

    for (const target of targets) {
      const appId = target.platformCredential!.appId.trim()
      const appSecret = target.platformCredential!.appSecret.trim()
      const domain = target.platformCredential!.domain.trim().toLowerCase() === 'lark' ? 'lark' : 'feishu'
      const allowedFileDirs = [
        this.resolveChannelWorkspaceRoot(settings, target),
        settings.claw.im.workspaceRoot,
        settings.workspaceRoot
      ]
        .map((entry) => entry.trim())
        .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
      const nextKey = `${target.id}|${appId}|${appSecret}|${domain}|${allowedFileDirs.join('|')}`
      const currentKey = this.feishuChannelKeys.get(target.id)
      if (this.feishuChannels.has(target.id) && currentKey === nextKey) continue
      if (this.feishuChannels.has(target.id)) {
        await this.closeFeishuChannel(target.id)
        if (version !== this.feishuSyncVersion) return
      }

      try {
        const bridge = createLarkChannel({
          appId,
          appSecret,
          domain: domain === 'lark' ? Domain.Lark : Domain.Feishu,
          loggerLevel: LoggerLevel.warn,
          source: 'deepseek-gui',
          transport: 'websocket',
          policy: {
            dmMode: 'open',
            requireMention: true,
            respondToMentionAll: true
          },
          ...(allowedFileDirs.length > 0
            ? { outbound: { allowedFileDirs } }
            : {})
        })
        bridge.on('message', async (message) => {
          await this.handleFeishuMessage(target.id, message)
        })
        bridge.on('error', (error) => {
          this.deps.logError('claw-feishu', 'Feishu channel error', {
            message: error.message,
            code: error.code,
            channelId: target.id
          })
        })
        bridge.on('reject', (event) => {
          this.deps.logError('claw-feishu', 'Feishu message rejected by channel policy', {
            ...event,
            channelId: target.id
          })
        })
        bridge.on('reconnecting', () => {
          this.deps.logError('claw-feishu', 'Feishu channel reconnecting', {
            channelId: target.id
          })
        })
        bridge.on('reconnected', () => {
          this.deps.logError('claw-feishu', 'Feishu channel reconnected', {
            channelId: target.id
          })
        })
        // The Feishu / Lark App admin subscribes to `im.message.message_read_v1`
        // in the developer console. The high-level `bridge.on(...)` API has no
        // entry for read receipts in its `EventMap`, and the SDK's internal
        // `EventDispatcher` does not pre-register a handler either — so the
        // dispatcher emits a `no im.message.message_read_v1 handle` warn on
        // every receipt. Register a no-op here to silence the warn until we
        // have product behavior for read receipts.
        //
        // TODO: replace this no-op with a real handler once we decide what to
        //       do with read receipts (e.g. track in chat store, update agent
        //       state, drive read-driven follow-ups).
        const dispatcher = (bridge as unknown as {
          dispatcher?: {
            register(handles: Record<string, (raw: unknown) => Promise<void> | void>): void
          }
        }).dispatcher
        dispatcher?.register({
          'im.message.message_read_v1': () => {
            // intentionally empty — see TODO above
          }
        })
        await bridge.connect()
        if (version !== this.feishuSyncVersion) {
          await bridge.disconnect().catch(() => undefined)
          return
        }
        this.feishuChannels.set(target.id, bridge)
        this.feishuChannelKeys.set(target.id, nextKey)
      } catch (error) {
        this.deps.logError('claw-feishu', 'Failed to start Feishu channel bridge', {
          message: error instanceof Error ? error.message : String(error),
          channelId: target.id
        })
      }
    }
  }

  private async closeFeishuChannel(channelId: string): Promise<void> {
    const bridge = this.feishuChannels.get(channelId)
    if (!bridge) return
    this.feishuChannels.delete(channelId)
    this.feishuChannelKeys.delete(channelId)
    await bridge.disconnect().catch((error) => {
      this.deps.logError('claw-feishu', 'Failed to stop Feishu channel bridge', {
        message: error instanceof Error ? error.message : String(error),
        channelId
      })
    })
  }

  private async closeAllFeishuChannels(): Promise<void> {
    const ids = [...this.feishuChannels.keys()]
    await Promise.all(ids.map((channelId) => this.closeFeishuChannel(channelId)))
  }

  private syncWebhook(settings: AppSettingsV1): void {
    const im = settings.claw.im
    const key = `${im.port}|${im.path}`
    if (this.server && this.serverKey === key) return
    this.closeWebhook()

    const server = createServer((req, res) => {
      void this.handleWebhook(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('claw-webhook', 'Claw IM webhook server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) {
        this.closeWebhook()
      }
    })
    server.listen(im.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  private closeWebhook(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const im = settings.claw.im
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/claw/internal/gui-plan/create' && req.method === 'POST') {
        // The legacy `gui_plan_create` MCP bridge is no longer the
        // active plan path. GUI plan creation now flows through the
        // native Kun `create_plan` tool. Reject legacy calls
        // loudly so older clients see a clear migration error.
        writeJson(res, 410, {
          ok: false,
          code: 'gui_plan_create_retired',
          message:
            'The /claw/internal/gui-plan/create endpoint is no longer active. Use the Kun create_plan tool.'
        })
        return
      }
      if (req.method !== 'POST' || url.pathname !== im.path) {
        writeJson(res, 404, { ok: false, message: 'Not found.' })
        return
      }
      if (!settings.claw.enabled || !im.enabled) {
        writeJson(res, 503, { ok: false, message: 'Claw IM webhook is disabled.' })
        return
      }
      if (im.secret) {
        const auth = req.headers.authorization ?? ''
        const headerSecret = Array.isArray(req.headers['x-deepseek-gui-secret'])
          ? req.headers['x-deepseek-gui-secret'][0]
          : req.headers['x-deepseek-gui-secret']
        if (auth !== `Bearer ${im.secret}` && headerSecret !== im.secret) {
          writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
          return
        }
      }

      const body = await readRequestBody(req)
      const payload = parseJsonObject(body)
      if (!payload) {
        writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
        return
      }
      const prompt = extractIncomingPrompt(payload)
      if (!prompt) {
        writeJson(res, 400, { ok: false, message: 'No message text found.' })
        return
      }
      const sender = extractSenderLabel(payload)
      const provider = extractIncomingProvider(payload, im.provider)
      const incomingChannelId = extractIncomingChannelId(payload)
      const channel = incomingChannelId
        ? settings.claw.channels.find(
            (item) => item.enabled && item.id === incomingChannelId
          ) ?? settings.claw.channels.find(
            (item) => item.enabled && item.provider === provider
          )
        : settings.claw.channels.find(
            (item) => item.enabled && item.provider === provider
          )
      const remoteSession = extractIncomingRemoteSession(payload)
      if (provider === 'feishu' && channel) {
        if (remoteSession) {
          await this.rememberFeishuRemoteSession(settings, channel, remoteSession)
        }
      }
      const conversation =
        channel && remoteSession
          ? this.findChannelConversation(channel, {
              chatId: remoteSession.chatId,
              threadId: remoteSession.threadId
            })
          : undefined
      // First inbound message on a freshly connected channel: push the
      // intro over the WeChat bridge when possible (it lands before the
      // model reply), otherwise prepend it to this response.
      let welcomePrefix = ''
      const welcomeText = this.pendingWelcomeText(settings, channel)
      if (welcomeText && channel) {
        this.welcomeInFlight.add(channel.id)
        try {
          const pushed = await this.pushWeixinWelcome(channel, remoteSession ?? undefined, welcomeText)
          if (!pushed) welcomePrefix = `${welcomeText}\n\n---\n\n`
          await this.markChannelWelcomeSent(channel.id)
        } finally {
          this.welcomeInFlight.delete(channel.id)
        }
      }
      const commandReply = await this.handleIncomingImCommand(settings, {
        text: prompt,
        channel,
        conversation,
        remoteSession: remoteSession ?? undefined
      })
      if (commandReply !== null) {
        writeJson(res, 200, { ok: true, reply: `${welcomePrefix}${commandReply}` })
        return
      }
      const taskCreation = await this.deps.createScheduledTaskFromText?.(prompt, {
        workspaceRoot: this.resolveChannelWorkspaceRoot(settings, channel),
        modelHint: channel?.model ?? im.model,
        mode: im.mode
      }) ?? { kind: 'noop' as const }
      if (taskCreation.kind === 'created') {
        writeJson(res, 200, { ok: true, createdTaskId: taskCreation.taskId, reply: `${welcomePrefix}${taskCreation.confirmationText}` })
        return
      }
      if (taskCreation.kind === 'error') {
        writeJson(res, 500, { ok: false, message: taskCreation.message })
        return
      }
      const result = await this.processIncomingImPrompt(settings, {
        prompt,
        sender,
        provider,
        channel,
        conversation,
        remoteSession: remoteSession ?? undefined
      })
      writeJson(res, result.ok ? 200 : 500, result.ok ? { ...result, reply: `${welcomePrefix}${result.text ?? ''}` } : result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('claw-webhook', 'Claw IM webhook request failed', { message })
      writeJson(res, 500, { ok: false, message })
    }
  }
}

export function createClawRuntime(deps: ClawRuntimeDeps): ClawRuntime {
  return new ClawRuntime(deps)
}
