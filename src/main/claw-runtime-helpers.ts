import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, join } from 'node:path'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawImProvider,
  ClawImRemoteSessionV1,
  ClawRunMode,
  ScheduleTaskFromTextResult
} from '../shared/app-settings'
import { CLAW_FEISHU_INBOUND_MESSAGE_HEADING } from '../shared/app-settings'
import type { JsonSettingsStore } from './settings-store'

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }

export type RuntimeRequestFn = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
) => Promise<RuntimeRequestResult>

export type ClawRuntimeDeps = {
  store: JsonSettingsStore
  runtimeRequest: RuntimeRequestFn
  logError: (category: string, message: string, detail?: unknown) => void
  notifyChannelActivity?: (payload: { channelId: string; threadId: string }) => void
  sendWeixinBridgeMessage?: (options: {
    accountId: string
    to: string
    text: string
  }) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>
  createScheduledTaskFromText?: (
    text: string,
    options?: { workspaceRoot?: string | null; modelHint?: string | null; mode?: ClawRunMode | null }
  ) => Promise<ScheduleTaskFromTextResult>
}

export type ThreadRecordJson = {
  id: string
  status?: string
}

export type TurnRecordJson = {
  id: string
  status?: string
  error?: string | null
  items?: TurnItemJson[]
}

export type TurnItemJson = {
  kind: string
  turnId?: string
  toolKind?: string
  output?: unknown
  isError?: boolean | null
  text?: string | null
  summary?: string
  detail?: string | null
}

export type ThreadDetailJson = {
  thread?: ThreadRecordJson
  id?: string
  status?: string
  turns?: TurnRecordJson[]
  items?: TurnItemJson[]
}

export type RunPromptOptions = {
  prompt: string
  displayText?: string
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

export const WEBHOOK_BODY_LIMIT_BYTES = 1_000_000

export function sanitizePathSegment(raw: string, fallback: string): string {
  const sanitized = raw
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}

export function feishuSenderLabel(message: NormalizedMessage): string {
  return message.senderName?.trim() || message.senderId.trim() || 'feishu-user'
}

export function buildFeishuPrompt(message: NormalizedMessage): string {
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

export function formatFeishuMirrorText(text: string, direction: 'user' | 'assistant'): { markdown: string } {
  const trimmed = text.trim()
  if (direction === 'user') {
    return {
      markdown: `**From DeepSeek GUI**\n\n> ${trimmed.replace(/\n/g, '\n> ')}`
    }
  }
  return { markdown: trimmed || '(empty reply)' }
}

export function clawConversationKey(chatId: string, remoteThreadId: string): string {
  return `${chatId.trim()}::${remoteThreadId.trim()}`
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function runtimeErrorMessage(result: RuntimeRequestResult, fallback: string): string {
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

export function isRunningStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

export function latestAssistantText(
  detail: ThreadDetailJson,
  options: { turnId?: string } = {}
): string {
  const turnId = options.turnId?.trim()
  const items = turnId
    ? threadItems(detail).filter((item) => item.turnId === turnId)
    : threadItems(detail)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'assistant_text' && item.kind !== 'agent_message') continue
    const text = (item.text ?? item.detail ?? item.summary ?? '').trim()
    if (text) return text
  }
  return ''
}

function outputRecord(output: unknown): Record<string, unknown> | null {
  return typeof output === 'object' && output !== null && !Array.isArray(output)
    ? output as Record<string, unknown>
    : null
}

function generatedFileFromToolResult(
  item: TurnItemJson,
  workspaceRoot: string
): ClawGeneratedFileV1 | null {
  if (item.kind !== 'tool_result' || item.toolKind !== 'file_change' || item.isError === true) return null
  const output = outputRecord(item.output)
  if (!output) return null
  const path = asString(output.path) || asString(output.absolute_path)
  const relativePath = asString(output.relative_path)
  const resolvedPath = path || (workspaceRoot && relativePath ? join(workspaceRoot, relativePath) : '')
  if (!resolvedPath) return null
  return {
    path: resolvedPath,
    ...(relativePath ? { relativePath } : {}),
    fileName: basename(relativePath || resolvedPath)
  }
}

function threadItems(detail: ThreadDetailJson): TurnItemJson[] {
  const turns = Array.isArray(detail.turns) ? detail.turns : []
  const singleTurnId = turns.length === 1 ? turns[0].id : ''
  const topLevelItems = Array.isArray(detail.items)
    ? detail.items.map((item) => ({ ...item, turnId: item.turnId || singleTurnId || undefined }))
    : []
  const turnItems = turns.flatMap((turn) =>
    Array.isArray(turn.items)
      ? turn.items.map((item) => ({ ...item, turnId: item.turnId || turn.id }))
      : []
  )
  return [
    ...topLevelItems,
    ...turnItems
  ]
}

function isPathLikeDuplicate(left: ClawGeneratedFileV1, right: ClawGeneratedFileV1): boolean {
  if (left.path === right.path) return true
  if (left.relativePath && left.relativePath === right.relativePath) return true
  if (isAbsolute(left.path) && isAbsolute(right.path)) return left.path === right.path
  return false
}

function extractGeneratedFiles(
  items: readonly TurnItemJson[],
  workspaceRoot: string,
  maxFiles: number
): ClawGeneratedFileV1[] {
  const files: ClawGeneratedFileV1[] = []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const file = generatedFileFromToolResult(items[index], workspaceRoot)
    if (!file) continue
    if (files.some((existing) => isPathLikeDuplicate(existing, file))) continue
    files.push(file)
    if (files.length >= maxFiles) break
  }
  return files.reverse()
}

export function latestGeneratedFiles(
  detail: ThreadDetailJson,
  options: { turnId?: string; workspaceRoot?: string; maxFiles?: number } = {}
): ClawGeneratedFileV1[] {
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? 3))
  const workspaceRoot = options.workspaceRoot?.trim() ?? ''
  const items = threadItems(detail)
  const turnId = options.turnId?.trim()
  if (turnId) {
    const currentTurnFiles = extractGeneratedFiles(
      items.filter((item) => item.turnId === turnId),
      workspaceRoot,
      maxFiles
    )
    if (currentTurnFiles.length > 0) return currentTurnFiles
  }
  return extractGeneratedFiles(items, workspaceRoot, maxFiles)
}

export function shouldSendGeneratedFilesForPrompt(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false
  return /发给我|发送给我|发一下|发来|发过来|传给我|传过来|上传|附件|以附件|发文件|文件发|文档发/i.test(text) ||
    /\b(send|attach|attachment|upload)\b/i.test(text) ||
    /给我(?:一个|一份)?.{0,24}(文档|文件|\.(?:md|txt|pdf|docx|xlsx|csv|pptx))/i.test(text)
}

export function shouldDirectSendExistingGeneratedFilesForPrompt(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false
  return /发给我|发送给我|发一下|发来|发过来|传给我|传过来|上传|附件|以附件|直接发|发文件|文件发|文档发/i.test(text) ||
    /\b(send|attach|attachment|upload)\b/i.test(text)
}

export function replyTextForGeneratedFiles(replyText: string, files: readonly ClawGeneratedFileV1[]): string {
  const trimmed = replyText.trim()
  if (files.length === 0) return trimmed
  const names = files.map((file) => file.fileName).join(', ')
  if (!trimmed || /(无法|不能|没办法).{0,20}(直接)?(通过)?(飞书|Lark|发送|发).{0,20}(文件|文档|附件)/i.test(trimmed)) {
    return `可以，我把 ${names} 作为附件发给你。`
  }
  return trimmed
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeTaskModel(model: string): string | undefined {
  const trimmed = model.trim()
  return trimmed || undefined
}

export function webhookUrl(settings: AppSettingsV1): string {
  return `http://127.0.0.1:${settings.claw.im.port}${settings.claw.im.path}`
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function asRawString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function extractIncomingPrompt(payload: Record<string, unknown>): string {
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

export function extractSenderLabel(payload: Record<string, unknown>): string {
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

export function normalizeIncomingProvider(value: unknown, fallback: ClawImProvider): ClawImProvider {
  const raw = asString(value).toLowerCase()
  if (raw === 'weixin' || raw === 'wechat') return 'weixin'
  return raw === 'feishu' ? 'feishu' : fallback
}

export function extractIncomingProvider(
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

export function extractIncomingChannelId(payload: Record<string, unknown>): string {
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

export function extractIncomingRemoteSession(
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

export function buildConversationLabel(session: Pick<ClawImRemoteSessionV1, 'chatId' | 'senderName'>): string {
  const sender = session.senderName.trim()
  if (sender) return sender
  const chatId = session.chatId.trim()
  return chatId.length > 12 ? chatId.slice(0, 12) : chatId
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

export async function readRequestBody(req: IncomingMessage): Promise<string> {
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
