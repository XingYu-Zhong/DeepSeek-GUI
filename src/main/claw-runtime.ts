import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
  type NormalizedMessage
} from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1,
  ClawImProvider,
  ClawRunMode,
  ClawRunResult,
  ClawRuntimeStatus,
  ClawTaskFromTextResult,
  ClawTaskV1
} from '../shared/app-settings'
import {
  DEFAULT_CLAW_MODEL,
  buildClawRuntimePrompt,
  CLAW_FEISHU_INBOUND_MESSAGE_HEADING,
  getActiveAgentRuntimeSettings
} from '../shared/app-settings'
import {
  buildClawTaskFromDetectedRequest,
  detectClawScheduledTaskRequest
} from './claw-scheduled-task-detector'
import type { JsonSettingsStore } from './settings-store'

type RuntimeRequestResult = { ok: boolean; status: number; body: string }

type RuntimeRequestFn = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
) => Promise<RuntimeRequestResult>

type ClawRuntimeDeps = {
  store: JsonSettingsStore
  runtimeRequest: RuntimeRequestFn
  logError: (category: string, message: string, detail?: unknown) => void
  notifyChannelActivity?: (payload: { channelId: string; threadId: string }) => void
}

type ThreadRecordJson = {
  id: string
  status?: string
}

type TurnRecordJson = {
  id: string
  status?: string
}

type TurnItemJson = {
  kind: string
  summary?: string
  detail?: string | null
}

type ThreadDetailJson = {
  thread: ThreadRecordJson
  turns?: TurnRecordJson[]
  items?: TurnItemJson[]
}

type RunPromptOptions = {
  prompt: string
  title: string
  workspaceRoot: string
  model: string
  mode: ClawRunMode
  waitForResult: boolean
  responseTimeoutMs: number
  source: 'task' | 'im'
  threadId?: string
  channel?: ClawImChannelV1
  onTurnStarted?: (payload: { threadId: string; turnId: string }) => Promise<void> | void
}

const SCHEDULER_INTERVAL_MS = 30_000
const WEBHOOK_BODY_LIMIT_BYTES = 1_000_000
const TASK_RESPONSE_TIMEOUT_MS = 30 * 60_000

function sanitizePathSegment(raw: string, fallback: string): string {
  const sanitized = raw
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}

function feishuSenderLabel(message: NormalizedMessage): string {
  return message.senderName?.trim() || message.senderId.trim() || 'feishu-user'
}

function buildFeishuPrompt(message: NormalizedMessage): string {
  const content = message.content.trim()
  const sender = feishuSenderLabel(message)
  const lines = [
    CLAW_FEISHU_INBOUND_MESSAGE_HEADING,
    `Chat type: ${message.chatType}`,
    `Sender: ${sender}`
  ]
  if (message.mentions.length > 0) {
    const mentionNames = message.mentions
      .map((mention) => mention.name?.trim() || mention.openId?.trim() || mention.userId?.trim() || '')
      .filter(Boolean)
    if (mentionNames.length > 0) {
      lines.push(`Mentions: ${mentionNames.join(', ')}`)
    }
  }
  if (message.rawContentType !== 'text') {
    lines.push(`Message type: ${message.rawContentType}`)
  }
  lines.push('', content || '[No text content]')
  return lines.join('\n')
}

function formatFeishuMirrorText(text: string, direction: 'user' | 'assistant'): { markdown: string } {
  const trimmed = text.trim()
  if (direction === 'user') {
    return {
      markdown: `**From DeepSeek GUI**\n\n> ${trimmed.replace(/\n/g, '\n> ')}`
    }
  }
  return { markdown: trimmed || '(empty reply)' }
}

function clawConversationKey(chatId: string, remoteThreadId: string): string {
  return `${chatId.trim()}::${remoteThreadId.trim()}`
}

function runtimeExecutionFlags(settings: AppSettingsV1): { auto_approve: boolean; trust_mode: boolean } {
  const runtime = getActiveAgentRuntimeSettings(settings)
  return {
    auto_approve: runtime.approvalPolicy === 'auto',
    trust_mode: runtime.sandboxMode === 'danger-full-access'
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function runtimeErrorMessage(result: RuntimeRequestResult, fallback: string): string {
  const parsed = parseJsonObject(result.body)
  if (parsed) {
    const message = parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim()
    const error = parsed.error
    if (typeof error === 'string' && error.trim()) return error.trim()
    if (typeof error === 'object' && error !== null) {
      const nested = (error as Record<string, unknown>).message
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
  }
  return result.body.trim() || fallback
}

function isRunningStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

function latestAssistantText(detail: ThreadDetailJson): string {
  const items = Array.isArray(detail.items) ? detail.items : []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'agent_message') continue
    const text = (item.detail ?? item.summary ?? '').trim()
    if (text) return text
  }
  return ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeTaskModel(model: string): string | undefined {
  const trimmed = model.trim()
  if (!trimmed || trimmed === DEFAULT_CLAW_MODEL) return undefined
  return trimmed
}

function summarizeTaskResult(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'Completed'
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 1_000)}...` : trimmed
}

function computeNextRunAt(task: ClawTaskV1, from: Date): string {
  if (!task.enabled || task.schedule.kind === 'manual') return ''
  if (task.schedule.kind === 'at') {
    return task.schedule.atTime.trim()
  }
  if (task.schedule.kind === 'interval') {
    return new Date(from.getTime() + task.schedule.everyMinutes * 60_000).toISOString()
  }

  const [hourRaw, minuteRaw] = task.schedule.timeOfDay.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0)
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.toISOString()
}

function webhookUrl(settings: AppSettingsV1): string {
  return `http://127.0.0.1:${settings.claw.im.port}${settings.claw.im.path}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function extractIncomingPrompt(payload: Record<string, unknown>): string {
  const candidates = [
    payload.text,
    payload.prompt,
    payload.message,
    nestedRecord(payload.message).text,
    nestedRecord(payload.event).text,
    nestedRecord(payload.data).text
  ]
  for (const candidate of candidates) {
    const text = asString(candidate)
    if (text) return text
  }
  return ''
}

function extractSenderLabel(payload: Record<string, unknown>): string {
  const candidates = [
    payload.sender,
    payload.user,
    payload.from,
    payload.conversationId,
    nestedRecord(payload.message).sender,
    nestedRecord(payload.event).sender,
    nestedRecord(payload.data).sender
  ]
  for (const candidate of candidates) {
    const text = asString(candidate)
    if (text) return text
  }
  return 'webhook'
}

function normalizeIncomingProvider(value: unknown, fallback: ClawImProvider): ClawImProvider {
  const raw = asString(value).toLowerCase()
  return raw === 'feishu' ? 'feishu' : fallback
}

function extractIncomingProvider(
  payload: Record<string, unknown>,
  fallback: ClawImProvider
): ClawImProvider {
  const candidates = [
    payload.provider,
    payload.platform,
    payload.im,
    payload.source,
    nestedRecord(payload.message).provider,
    nestedRecord(payload.event).provider,
    nestedRecord(payload.data).provider
  ]
  for (const candidate of candidates) {
    const provider = normalizeIncomingProvider(candidate, fallback)
    if (provider !== fallback || asString(candidate).toLowerCase() === fallback) return provider
  }
  return fallback
}

function extractIncomingChannelId(payload: Record<string, unknown>): string {
  const candidates = [
    payload.channelId,
    payload.channel_id,
    nestedRecord(payload.message).channelId,
    nestedRecord(payload.event).channelId,
    nestedRecord(payload.data).channelId
  ]
  for (const candidate of candidates) {
    const text = asString(candidate)
    if (text) return text
  }
  return ''
}

function extractIncomingRemoteSession(
  payload: Record<string, unknown>
): Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'> | null {
  const message = nestedRecord(payload.message)
  const event = nestedRecord(payload.event)
  const eventMessage = nestedRecord(event.message)
  const header = nestedRecord(event.header)
  const sender = nestedRecord(payload.sender)
  const eventSender = nestedRecord(event.sender)

  const chatId = asString(
    payload.chatId ||
    payload.chat_id ||
    payload.open_chat_id ||
    message.chatId ||
    message.chat_id ||
    eventMessage.chat_id ||
    eventMessage.chatId
  )
  const messageId = asString(
    payload.messageId ||
    payload.message_id ||
    message.messageId ||
    message.message_id ||
    eventMessage.message_id ||
    eventMessage.messageId ||
    header.message_id
  )
  if (!chatId || !messageId) return null

  const threadId = asString(
    payload.threadId ||
    payload.thread_id ||
    message.threadId ||
    message.thread_id ||
    eventMessage.thread_id ||
    eventMessage.threadId
  )
  const senderId = asString(
    payload.senderId ||
    payload.sender_id ||
    sender.id ||
    sender.open_id ||
    sender.user_id ||
    eventSender.sender_id ||
    eventSender.open_id ||
    eventSender.user_id
  )
  const senderName = asString(
    payload.senderName ||
    payload.sender_name ||
    sender.name ||
    eventSender.sender_name ||
    eventSender.name
  )
  return { chatId, messageId, threadId, senderId, senderName }
}

function buildConversationLabel(session: Pick<ClawImRemoteSessionV1, 'chatId' | 'senderName'>): string {
  const sender = session.senderName.trim()
  if (sender) return sender
  const chatId = session.chatId.trim()
  return chatId.length > 12 ? chatId.slice(0, 12) : chatId
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > WEBHOOK_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseRequestJson(body: string): Record<string, unknown> | null {
  return parseJsonObject(body)
}

export class ClawRuntime {
  private readonly deps: ClawRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private server: Server | null = null
  private serverKey = ''
  private feishuChannels = new Map<string, LarkChannel>()
  private feishuChannelKeys = new Map<string, string>()
  private feishuSyncVersion = 0
  private runningTaskIds = new Set<string>()

  constructor(deps: ClawRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.syncWebhook(settings)
    void this.syncFeishuChannels(settings)
    this.startScheduler()
    void this.ensureNextRuns(settings)
  }

  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    this.closeWebhook()
    void this.closeAllFeishuChannels()
  }

  async status(): Promise<ClawRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      imServerRunning: this.server !== null && settings.claw.enabled && settings.claw.im.enabled,
      imUrl: webhookUrl(settings),
      runningTaskIds: [...this.runningTaskIds]
    }
  }

  async runTask(taskId: string): Promise<ClawRunResult> {
    const settings = await this.deps.store.load()
    const task = settings.claw.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, message: 'Task not found.' }
    return this.runTaskInternal(task, false)
  }

  async createScheduledTaskFromText(
    text: string,
    options: { channelId?: string | null; modelHint?: string | null; mode?: ClawRunMode | null } = {}
  ): Promise<ClawTaskFromTextResult> {
    const settings = await this.deps.store.load()
    const channel = options.channelId
      ? settings.claw.channels.find((item) => item.id === options.channelId)
      : undefined
    try {
      const request = await detectClawScheduledTaskRequest(
        settings,
        text,
        options.modelHint?.trim() || channel?.model || settings.claw.im.model || DEFAULT_CLAW_MODEL
      )
      if (!request) return { kind: 'noop' }
      const task = buildClawTaskFromDetectedRequest({
        request,
        workspaceRoot: this.resolveChannelWorkspaceRoot(settings, channel),
        model: channel?.model || settings.claw.im.model || DEFAULT_CLAW_MODEL,
        mode: options.mode ?? settings.claw.im.mode,
        id: randomUUID()
      })
      const saved = await this.deps.store.patch({
        claw: {
          enabled: true,
          tasks: [...settings.claw.tasks, task]
        }
      })
      this.sync(saved)
      return {
        kind: 'created',
        taskId: task.id,
        title: task.title,
        scheduleAt: request.scheduleAt,
        confirmationText: request.confirmationText
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('claw-task', 'Failed to create scheduled task from text', { message, text })
      return { kind: 'error', message }
    }
  }

  async listTasks(): Promise<ClawTaskV1[]> {
    const settings = await this.deps.store.load()
    return settings.claw.tasks
  }

  async createTask(task: ClawTaskV1): Promise<ClawTaskV1> {
    const settings = await this.deps.store.load()
    const saved = await this.deps.store.patch({
      claw: {
        enabled: true,
        tasks: [...settings.claw.tasks, task]
      }
    })
    this.sync(saved)
    return saved.claw.tasks.find((item) => item.id === task.id) ?? task
  }

  async createTaskFromInput(input: {
    title: string
    prompt: string
    workspaceRoot?: string
    model?: string
    mode?: ClawRunMode
    enabled?: boolean
    schedule: Partial<ClawTaskV1['schedule']> & { kind: ClawTaskV1['schedule']['kind'] }
  }): Promise<ClawTaskV1> {
    const settings = await this.deps.store.load()
    const now = new Date().toISOString()
    const task: ClawTaskV1 = {
      id: randomUUID(),
      title: input.title.trim() || 'New Claw task',
      enabled: input.enabled !== false,
      prompt: input.prompt,
      workspaceRoot: input.workspaceRoot?.trim() || settings.workspaceRoot,
      model: input.model?.trim() || settings.claw.im.model || DEFAULT_CLAW_MODEL,
      mode: input.mode ?? settings.claw.im.mode,
      schedule: {
        kind: input.schedule.kind,
        everyMinutes: typeof input.schedule.everyMinutes === 'number' ? input.schedule.everyMinutes : 60,
        timeOfDay: input.schedule.timeOfDay?.trim() || '09:00',
        atTime: input.schedule.atTime?.trim() || ''
      },
      createdAt: now,
      updatedAt: now,
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      lastThreadId: ''
    }
    const saved = await this.createTask(task)
    await this.ensureNextRuns(await this.deps.store.load())
    return saved
  }

  async updateTaskById(taskId: string, patch: Partial<ClawTaskV1>): Promise<ClawTaskV1 | null> {
    const settings = await this.deps.store.load()
    const task = settings.claw.tasks.find((item) => item.id === taskId)
    if (!task) return null
    const now = new Date().toISOString()
    const nextTask: ClawTaskV1 = {
      ...task,
      ...patch,
      updatedAt: now
    }
    const saved = await this.deps.store.patch({
      claw: {
        tasks: settings.claw.tasks.map((item) => (item.id === taskId ? nextTask : item))
      }
    })
    this.sync(saved)
    return saved.claw.tasks.find((item) => item.id === taskId) ?? nextTask
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const settings = await this.deps.store.load()
    if (!settings.claw.tasks.some((item) => item.id === taskId)) return false
    const saved = await this.deps.store.patch({
      claw: {
        tasks: settings.claw.tasks.filter((item) => item.id !== taskId)
      }
    })
    this.sync(saved)
    return saved.claw.tasks.every((item) => item.id !== taskId)
  }

  private startScheduler(): void {
    if (this.scheduler) return
    this.scheduler = setInterval(() => {
      void this.tick()
    }, SCHEDULER_INTERVAL_MS)
    this.scheduler.unref?.()
    void this.tick()
  }

  private async tick(): Promise<void> {
    const settings = await this.deps.store.load()
    if (!settings.claw.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.deps.store.load()
    const now = Date.now()
    for (const task of fresh.claw.tasks) {
      if (!task.enabled || task.schedule.kind === 'manual') continue
      if (this.runningTaskIds.has(task.id)) continue
      const dueAt = Date.parse(task.nextRunAt)
      if (!Number.isFinite(dueAt) || dueAt > now) continue
      void this.runTaskInternal(task, true)
    }
  }

  private async ensureNextRuns(settings: AppSettingsV1): Promise<void> {
    if (!settings.claw.enabled) return
    let changed = false
    const now = new Date()
    const tasks = settings.claw.tasks.map((task) => {
      const wasInterrupted = task.lastStatus === 'running' && !this.runningTaskIds.has(task.id)
      if (!task.enabled || task.schedule.kind === 'manual' || this.runningTaskIds.has(task.id)) {
        if (!wasInterrupted) return task
        changed = true
        return {
          ...task,
          ...(task.schedule.kind === 'at' ? { enabled: false } : {}),
          nextRunAt: task.schedule.kind === 'at' ? '' : task.nextRunAt,
          lastStatus: 'error' as const,
          lastMessage: 'Task was interrupted before completion.',
          updatedAt: now.toISOString()
        }
      }
      if (task.nextRunAt && !wasInterrupted) return task
      changed = true
      return {
        ...task,
        nextRunAt: computeNextRunAt(task, now),
        ...(wasInterrupted
          ? {
              lastStatus: 'error' as const,
              lastMessage: 'Task was interrupted before completion.',
              updatedAt: now.toISOString()
            }
          : {})
      }
    })
    if (!changed) return
    const saved = await this.deps.store.patch({ claw: { ...settings.claw, tasks } })
    this.syncWebhook(saved)
  }

  private async updateTask(
    taskId: string,
    updater: (task: ClawTaskV1, settings: AppSettingsV1) => ClawTaskV1
  ): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    const tasks = settings.claw.tasks.map((task) => task.id === taskId ? updater(task, settings) : task)
    const saved = await this.deps.store.patch({ claw: { ...settings.claw, tasks } })
    this.syncWebhook(saved)
    return saved
  }

  private async runTaskInternal(task: ClawTaskV1, scheduled: boolean): Promise<ClawRunResult> {
    if (this.runningTaskIds.has(task.id)) {
      return { ok: false, message: 'Task is already running.' }
    }
    if (scheduled && (!task.enabled || task.schedule.kind === 'manual')) {
      return { ok: false, message: 'Task is not scheduled.' }
    }
    if (!task.prompt.trim()) {
      return { ok: false, message: 'Task prompt is empty.' }
    }

    this.runningTaskIds.add(task.id)
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      updatedAt: new Date().toISOString()
    }))

    try {
      const settings = await this.deps.store.load()
      const result = await this.runPrompt(settings, {
        prompt: task.prompt,
        title: `[Claw] ${task.title}`,
        workspaceRoot: task.workspaceRoot || settings.workspaceRoot,
        model: task.model,
        mode: task.mode,
        waitForResult: false,
        responseTimeoutMs: TASK_RESPONSE_TIMEOUT_MS,
        source: 'task'
      })
      if (!result.ok) {
        const finishedAt = new Date()
        await this.updateTask(task.id, (current) => ({
          ...current,
          ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
          lastRunAt: finishedAt.toISOString(),
          nextRunAt: current.schedule.kind === 'at' ? '' : computeNextRunAt(current, finishedAt),
          lastStatus: 'error',
          lastMessage: result.message,
          updatedAt: finishedAt.toISOString()
        }))
        this.runningTaskIds.delete(task.id)
        return result
      }

      const startedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: startedAt.toISOString(),
        nextRunAt: current.schedule.kind === 'at' ? '' : '',
        lastStatus: 'running',
        lastMessage: result.message ?? 'Started',
        lastThreadId: result.threadId,
        updatedAt: startedAt.toISOString()
      }))
      void this.monitorTaskTurn(task.id, result.threadId, result.turnId ?? '')
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: computeNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: message,
        updatedAt: finishedAt.toISOString()
      }))
      this.runningTaskIds.delete(task.id)
      return { ok: false, message }
    }
  }

  private async monitorTaskTurn(taskId: string, threadId: string, turnId: string): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const text = await this.waitForAssistantText(settings, threadId, turnId, TASK_RESPONSE_TIMEOUT_MS)
      const finishedAt = new Date()
      await this.updateTask(taskId, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeNextRunAt(current, finishedAt),
        lastStatus: 'success',
        lastMessage: summarizeTaskResult(text),
        lastThreadId: threadId,
        updatedAt: finishedAt.toISOString()
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()
      await this.updateTask(taskId, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: message,
        lastThreadId: threadId || current.lastThreadId,
        updatedAt: finishedAt.toISOString()
      }))
      this.deps.logError('claw-task', 'Claw scheduled task failed', { message, taskId, threadId })
    } finally {
      this.runningTaskIds.delete(taskId)
    }
  }

  private async runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ClawRunResult> {
    const flags = runtimeExecutionFlags(settings)
    const workspace = options.workspaceRoot.trim() || settings.workspaceRoot
    const existingThreadId = options.threadId?.trim()
    let thread: ThreadRecordJson
    if (existingThreadId) {
      thread = { id: existingThreadId }
    } else {
      const create = await this.deps.runtimeRequest(settings, '/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ workspace, mode: options.mode, ...flags })
      })
      if (!create.ok) return { ok: false, message: runtimeErrorMessage(create, 'Failed to create thread.') }
      thread = JSON.parse(create.body) as ThreadRecordJson
    }
    if (!existingThreadId && options.title.trim()) {
      void this.deps.runtimeRequest(settings, `/v1/threads/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: options.title.trim() })
      })
    }

    const model = normalizeTaskModel(options.model)
    const turnBody: Record<string, unknown> = {
      prompt: buildClawRuntimePrompt(settings, options.prompt, { channel: options.channel }),
      mode: options.mode,
      ...flags
    }
    if (model) turnBody.model = model

    const turn = await this.deps.runtimeRequest(
      settings,
      `/v1/threads/${encodeURIComponent(thread.id)}/turns`,
      { method: 'POST', body: JSON.stringify(turnBody) }
    )
    if (!turn.ok) return { ok: false, message: runtimeErrorMessage(turn, 'Failed to start turn.') }

    const parsedTurn = parseJsonObject(turn.body)
    const turnId = asString(nestedRecord(parsedTurn?.turn).id)
    if (turnId && options.onTurnStarted) {
      await options.onTurnStarted({ threadId: thread.id, turnId })
    }
    if (!options.waitForResult) {
      return { ok: true, threadId: thread.id, turnId, message: 'Started' }
    }

    const text = await this.waitForAssistantText(settings, thread.id, turnId, options.responseTimeoutMs)
    return { ok: true, threadId: thread.id, turnId, text, message: text || 'Completed' }
  }

  private async waitForAssistantText(
    settings: AppSettingsV1,
    threadId: string,
    turnId: string,
    timeoutMs: number
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let lastText = ''
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
      lastText = latestAssistantText(detail) || lastText
      const targetTurn = Array.isArray(detail.turns)
        ? detail.turns.find((turn) => turn.id === turnId)
        : undefined
      const threadDone = !isRunningStatus(detail.thread.status)
      const turnDone = targetTurn ? !isRunningStatus(targetTurn.status) : threadDone
      if (turnDone && lastText) return lastText
    }
    if (lastText) return lastText
    throw new Error('Timed out waiting for CodeWhale response.')
  }

  private resolveChannelWorkspaceRoot(settings: AppSettingsV1, channel?: ClawImChannelV1): string {
    return channel?.workspaceRoot.trim() || settings.claw.im.workspaceRoot.trim() || settings.workspaceRoot
  }

  private resolveConversationWorkspaceRoot(channel: ClawImChannelV1, session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>): string {
    const base = channel.workspaceRoot.trim()
    const key = sanitizePathSegment(session.threadId.trim() || session.chatId.trim(), 'conversation')
    return `${base.replace(/\/+$/, '')}/conversations/${key}`
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
    const initialThreadId = conversation?.localThreadId.trim() || channel?.threadId.trim() || ''
    const result = await this.runPrompt(settings, {
      prompt,
      title: channel ? `[Claw IM:${channel.label}] ${sender}` : `[Claw IM:${provider}] ${sender}`,
      workspaceRoot: conversation?.workspaceRoot.trim()
        || (channel && remoteSession ? this.resolveConversationWorkspaceRoot(channel, remoteSession) : '')
        || this.resolveChannelWorkspaceRoot(settings, channel),
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
        if (remoteSession) {
          const existingConversation = conversation ?? this.findChannelConversation(channel, remoteSession)
          const nextConversation: ClawImConversationV1 = existingConversation
            ? {
                ...existingConversation,
                latestMessageId: remoteSession.messageId,
                senderId: remoteSession.senderId,
                senderName: remoteSession.senderName,
                localThreadId: threadId,
                workspaceRoot: existingConversation.workspaceRoot || this.resolveConversationWorkspaceRoot(channel, remoteSession),
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
                workspaceRoot: this.resolveConversationWorkspaceRoot(channel, remoteSession),
                createdAt: now,
                updatedAt: now
              }
          await this.deps.store.patch({
            claw: {
              channels: settings.claw.channels.map((item) =>
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
              channels: settings.claw.channels.map((item) =>
                item.id === channel.id
                  ? { ...item, threadId, updatedAt: now }
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

  private resolveFeishuChannels(settings: AppSettingsV1): ClawImChannelV1[] {
    if (!settings.claw.enabled) return []
    return settings.claw.channels.filter(
      (channel) =>
        channel.enabled &&
        channel.provider === 'feishu' &&
        !!channel.platformCredential?.appId.trim() &&
        !!channel.platformCredential?.appSecret.trim()
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

  async mirrorThreadMessageToFeishu(
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'Message is empty.' }
    const settings = await this.deps.store.load()
    const channel = settings.claw.channels.find(
      (item) => item.enabled && item.conversations.some((conversation) => conversation.localThreadId === threadId)
    )
    if (!channel) return { ok: false, message: 'Channel not found.' }
    if (channel.provider !== 'feishu') return { ok: false, message: 'Only Feishu / Lark is supported.' }
    const conversation =
      [...channel.conversations]
        .filter((item) => item.localThreadId === threadId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    if (!conversation?.chatId.trim()) {
      return { ok: false, message: 'No target Feishu / Lark conversation is available yet.' }
    }
    const bridge = this.feishuChannels.get(channel.id)
    if (!bridge) {
      return { ok: false, message: 'Feishu / Lark bridge is not connected.' }
    }
    try {
      await bridge.send(
        conversation.chatId,
        formatFeishuMirrorText(trimmed, direction)
      )
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('claw-feishu', 'Failed to mirror Claw message to Feishu / Lark', {
        message,
        threadId,
        direction
      })
      return { ok: false, message }
    }
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

    const sender = feishuSenderLabel(message)
    const taskCreation = await this.createScheduledTaskFromText(message.content, {
      channelId: channel.id,
      modelHint: channel.model,
      mode: settings.claw.im.mode
    })
    if (taskCreation.kind === 'created') {
      await bridge.send(
        message.chatId,
        { text: taskCreation.confirmationText },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }
      )
      return
    }
    if (taskCreation.kind === 'error') {
      await bridge.send(
        message.chatId,
        { text: `Failed to create the scheduled task: ${taskCreation.message}` },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }
      )
      return
    }
    if (!message.content.trim() && message.rawContentType !== 'text') {
      try {
        await bridge.send(
          message.chatId,
          { text: 'Only text messages are supported right now.' },
          { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }
        )
      } catch (error) {
        this.deps.logError('claw-feishu', 'Failed to send unsupported-message reply', {
          message: error instanceof Error ? error.message : String(error),
          chatId: message.chatId
        })
      }
      return
    }

    try {
      const result = await this.processIncomingImPrompt(settings, {
        prompt: buildFeishuPrompt(message),
        sender,
        provider: 'feishu',
        channel,
        conversation,
        remoteSession
      })
      const replyText = result.ok
        ? (result.text?.trim() || result.message?.trim() || 'Completed.')
        : (result.message.trim() || 'Sorry, something went wrong while handling your message.')
      await bridge.send(
        message.chatId,
        { text: replyText },
        { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }
      )
    } catch (error) {
      this.deps.logError('claw-feishu', 'Failed to handle Feishu inbound message', {
        message: error instanceof Error ? error.message : String(error),
        chatId: message.chatId,
        senderId: message.senderId
      })
      try {
        await bridge.send(
          message.chatId,
          { text: 'Sorry, I could not process your message right now.' },
          { replyTo: message.messageId, replyInThread: Boolean(message.threadId) }
        )
      } catch {
        /* ignore secondary reply failures */
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
      const nextKey = `${target.id}|${appId}|${appSecret}|${domain}`
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
          }
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
      if (url.pathname === '/claw/internal/schedule/list' && req.method === 'POST') {
        const tasks = await this.listTasks()
        writeJson(res, 200, { ok: true, tasks })
        return
      }
      if (url.pathname === '/claw/internal/schedule/create' && req.method === 'POST') {
        const body = await readRequestBody(req)
        const payload = parseRequestJson(body)
        if (!payload) {
          writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
          return
        }
        const input = nestedRecord(payload.input)
        if (!input || Object.keys(input).length === 0) {
          writeJson(res, 400, { ok: false, message: 'Missing task input.' })
          return
        }
        const title = asString(input.title)
        const prompt = asString(input.prompt)
        const schedule = nestedRecord(input.schedule)
        const kind = asString(schedule.kind) as ClawTaskV1['schedule']['kind']
        if (!prompt || !kind) {
          writeJson(res, 400, { ok: false, message: 'Missing prompt or schedule.kind.' })
          return
        }
        const saved = await this.createTaskFromInput({
          title,
          prompt,
          workspaceRoot: asString(input.workspaceRoot) || undefined,
          model: asString(input.model) || undefined,
          mode: (asString(input.mode) as ClawRunMode) || undefined,
          enabled: input.enabled === false ? false : true,
          schedule: {
            kind,
            everyMinutes: Number(schedule.everyMinutes),
            timeOfDay: asString(schedule.timeOfDay),
            atTime: asString(schedule.atTime)
          }
        })
        writeJson(res, 200, { ok: true, task: saved })
        return
      }
      if (url.pathname === '/claw/internal/schedule/update' && req.method === 'POST') {
        const body = await readRequestBody(req)
        const payload = parseRequestJson(body)
        if (!payload) {
          writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
          return
        }
        const taskId = asString(payload.taskId)
        const patch = nestedRecord(payload.patch)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const updated = await this.updateTaskById(taskId, patch as Partial<ClawTaskV1>)
        if (!updated) {
          writeJson(res, 404, { ok: false, message: 'Task not found.' })
          return
        }
        writeJson(res, 200, { ok: true, task: updated })
        return
      }
      if (url.pathname === '/claw/internal/schedule/delete' && req.method === 'POST') {
        const body = await readRequestBody(req)
        const payload = parseRequestJson(body)
        if (!payload) {
          writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
          return
        }
        const taskId = asString(payload.taskId)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const removed = await this.deleteTaskById(taskId)
        writeJson(res, removed ? 200 : 404, removed ? { ok: true } : { ok: false, message: 'Task not found.' })
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
      const remoteSession = provider === 'feishu' ? extractIncomingRemoteSession(payload) : null
      if (provider === 'feishu' && channel) {
        if (remoteSession) {
          await this.rememberFeishuRemoteSession(settings, channel, remoteSession)
        }
      }
      const taskCreation = await this.createScheduledTaskFromText(prompt, {
        channelId: channel?.id,
        modelHint: channel?.model ?? im.model,
        mode: im.mode
      })
      if (taskCreation.kind === 'created') {
        writeJson(res, 200, { ok: true, createdTaskId: taskCreation.taskId, reply: taskCreation.confirmationText })
        return
      }
      if (taskCreation.kind === 'error') {
        writeJson(res, 500, { ok: false, message: taskCreation.message })
        return
      }
      const conversation =
        provider === 'feishu' && channel && remoteSession
          ? this.findChannelConversation(channel, {
              chatId: remoteSession.chatId,
              threadId: remoteSession.threadId
            })
          : undefined
      const result = await this.processIncomingImPrompt(settings, {
        prompt,
        sender,
        provider,
        channel,
        conversation,
        remoteSession: remoteSession ?? undefined
      })
      writeJson(res, result.ok ? 200 : 500, result.ok ? { ...result, reply: result.text ?? '' } : result)
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
