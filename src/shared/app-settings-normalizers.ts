import {
  DEFAULT_DEEPSEEK_BASE_URL,
  type ClawImProvider,
  type ClawModel,
  type ClawRunMode,
  type ScheduleKind,
  type ScheduleModel,
  type ScheduleReasoningEffort,
  type ScheduleTaskStatus
} from './app-settings-types'

export function normalizeDeepseekBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  return trimmed || DEFAULT_DEEPSEEK_BASE_URL
}

export function compactStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export function normalizeRunMode(value: unknown): ClawRunMode {
  return value === 'plan' ? 'plan' : 'agent'
}

export function normalizeImProvider(value: unknown): ClawImProvider {
  return value === 'weixin' ? 'weixin' : 'feishu'
}

export function normalizeClawModel(value: unknown): ClawModel {
  return value === 'deepseek-v4-pro' || value === 'deepseek-v4-flash' ? value : 'deepseek-v4-pro'
}

export function normalizeScheduleModel(value: unknown): ScheduleModel {
  return normalizeClawModel(value)
}

export function normalizeScheduleReasoningEffort(value: unknown): ScheduleReasoningEffort {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max') return value
  return 'medium'
}

export function normalizeScheduleKind(value: unknown): ScheduleKind {
  if (value === 'interval' || value === 'daily' || value === 'at') return value
  return 'manual'
}

export function normalizeTimeOfDay(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '09:00'
}

export function normalizeAtTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

export function normalizePathSegment(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '/claw/im'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function normalizeStatus(value: unknown): ScheduleTaskStatus {
  if (value === 'running' || value === 'success' || value === 'error') return value
  return 'idle'
}
