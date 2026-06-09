import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  AppSettingsV1,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduledTaskV1
} from '../shared/app-settings'
import type { JsonSettingsStore } from './settings-store'

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }

export type RuntimeRequestFn = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
) => Promise<RuntimeRequestResult>

export type PowerSaveBlockerLike = {
  start: (type: 'prevent-app-suspension' | 'prevent-display-sleep') => number
  stop: (id: number) => void
  isStarted: (id: number) => boolean
}

export type ScheduleRuntimeDeps = {
  store: JsonSettingsStore
  runtimeRequest: RuntimeRequestFn
  logError: (category: string, message: string, detail?: unknown) => void
  powerSaveBlocker?: PowerSaveBlockerLike
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
  title: string
  workspaceRoot: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  waitForResult: boolean
  responseTimeoutMs: number
}

export const SCHEDULER_INTERVAL_MS = 30_000
export const INTERNAL_BODY_LIMIT_BYTES = 1_000_000
export const TASK_RESPONSE_TIMEOUT_MS = 30 * 60_000

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
  return [...topLevelItems, ...turnItems]
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeTaskModel(model: string): string | undefined {
  const trimmed = model.trim()
  return trimmed || undefined
}

export function summarizeTaskResult(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'Completed'
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 1_000)}...` : trimmed
}

export function computeScheduleNextRunAt(task: ScheduledTaskV1, from: Date): string {
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

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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
    if (size > INTERNAL_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function internalUrl(settings: AppSettingsV1): string {
  return `http://127.0.0.1:${settings.schedule.internal.port}`
}

export function hasEnabledScheduledTask(settings: AppSettingsV1): boolean {
  return settings.schedule.tasks.some((task) => task.enabled && task.schedule.kind !== 'manual')
}
