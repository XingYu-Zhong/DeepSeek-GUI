import { useEffect, useState } from 'react'
import { parseUsageResponse } from './usage-response'

export const DEFAULT_USAGE_HEATMAP_DAYS = 90

export type DailyUsageBucket = {
  date: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
  threadCount: number
  cacheHitRate: number | null
}

export type DailyUsageTotals = Omit<DailyUsageBucket, 'date'> & {
  days: number
  activeDays: number
}

export type DailyUsageSummary = {
  groupBy: 'day'
  from: string
  to: string
  timezone: string
  buckets: DailyUsageBucket[]
  totals: DailyUsageTotals
}

export type DailyUsageState = {
  usage: DailyUsageSummary | null
  loading: boolean
  loaded: boolean
  error: string | null
}

type RawDailyUsageBucket = {
  date?: unknown
  input_tokens?: unknown
  output_tokens?: unknown
  reasoning_tokens?: unknown
  cached_tokens?: unknown
  cache_miss_tokens?: unknown
  total_tokens?: unknown
  cost_usd?: unknown
  cost_cny?: unknown
  cache_savings_usd?: unknown
  cache_savings_cny?: unknown
  token_economy_savings_tokens?: unknown
  token_economy_savings_usd?: unknown
  token_economy_savings_cny?: unknown
  turns?: unknown
  thread_count?: unknown
  cache_hit_rate?: unknown
}

type RawDailyUsageResponse = {
  group_by?: unknown
  from?: unknown
  to?: unknown
  timezone?: unknown
  buckets?: unknown
  totals?: unknown
}

export type DailyUsageRange = {
  from: string
  to: string
  timezone: string
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function dateStringFromParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function defaultDailyUsageRange(now = new Date(), days = DEFAULT_USAGE_HEATMAP_DAYS): DailyUsageRange {
  const timezone = clientTimezone()
  const rangeDays = Math.max(7, Math.round(days))
  const to = dateStringFromParts(now, timezone)
  return {
    from: addDays(to, -(rangeDays - 1)),
    to,
    timezone
  }
}

export function buildDailyUsagePath(range: DailyUsageRange): string {
  const params = new URLSearchParams()
  params.set('group_by', 'day')
  params.set('from', range.from)
  params.set('to', range.to)
  params.set('timezone', range.timezone)
  return `/v1/usage?${params.toString()}`
}

function normalizeBucket(raw: RawDailyUsageBucket): DailyUsageBucket {
  const date = typeof raw.date === 'string' ? raw.date : ''
  const inputTokens = usageNumber(raw.input_tokens)
  const outputTokens = usageNumber(raw.output_tokens)
  const totalTokens = usageNumber(raw.total_tokens) || inputTokens + outputTokens
  return {
    date,
    inputTokens,
    outputTokens,
    reasoningTokens: usageNumber(raw.reasoning_tokens),
    cachedTokens: usageNumber(raw.cached_tokens),
    cacheMissTokens: usageNumber(raw.cache_miss_tokens),
    totalTokens,
    costUsd: usageNumber(raw.cost_usd),
    costCny: usageOptionalNumber(raw.cost_cny),
    cacheSavingsUsd: usageNumber(raw.cache_savings_usd),
    cacheSavingsCny: usageOptionalNumber(raw.cache_savings_cny),
    tokenEconomySavingsTokens: usageNumber(raw.token_economy_savings_tokens),
    tokenEconomySavingsUsd: usageNumber(raw.token_economy_savings_usd),
    tokenEconomySavingsCny: usageOptionalNumber(raw.token_economy_savings_cny),
    turns: usageNumber(raw.turns),
    threadCount: usageNumber(raw.thread_count),
    cacheHitRate: usageRate(raw.cache_hit_rate)
  }
}

function normalizeTotals(raw: RawDailyUsageBucket & { days?: unknown; active_days?: unknown }): DailyUsageTotals {
  const bucket = normalizeBucket({ ...raw, date: 'totals' })
  return {
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    reasoningTokens: bucket.reasoningTokens,
    cachedTokens: bucket.cachedTokens,
    cacheMissTokens: bucket.cacheMissTokens,
    totalTokens: bucket.totalTokens,
    costUsd: bucket.costUsd,
    costCny: bucket.costCny,
    cacheSavingsUsd: bucket.cacheSavingsUsd,
    cacheSavingsCny: bucket.cacheSavingsCny,
    tokenEconomySavingsTokens: bucket.tokenEconomySavingsTokens,
    tokenEconomySavingsUsd: bucket.tokenEconomySavingsUsd,
    tokenEconomySavingsCny: bucket.tokenEconomySavingsCny,
    turns: bucket.turns,
    threadCount: bucket.threadCount,
    cacheHitRate: bucket.cacheHitRate,
    days: usageNumber(raw.days),
    activeDays: usageNumber(raw.active_days)
  }
}

export function normalizeDailyUsageResponse(raw: RawDailyUsageResponse): DailyUsageSummary {
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets
        .map((item) => normalizeBucket((item ?? {}) as RawDailyUsageBucket))
        .filter((bucket) => bucket.date)
    : []
  return {
    groupBy: 'day',
    from: typeof raw.from === 'string' ? raw.from : buckets[0]?.date ?? '',
    to: typeof raw.to === 'string' ? raw.to : buckets[buckets.length - 1]?.date ?? '',
    timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : clientTimezone(),
    buckets,
    totals: normalizeTotals((raw.totals ?? {}) as RawDailyUsageBucket & { days?: unknown; active_days?: unknown })
  }
}

export async function loadDailyUsage(range: DailyUsageRange): Promise<DailyUsageSummary | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const response = await window.dsGui.runtimeRequest(buildDailyUsagePath(range), 'GET')
  if (!response.ok || !response.body.trim()) {
    throw new Error(`daily usage request failed: ${response.status}`)
  }
  const parsed = parseUsageResponse<RawDailyUsageResponse>(response.body, 'daily usage')
  if (parsed.group_by !== 'day') {
    throw new Error('daily usage response did not use day grouping')
  }
  return normalizeDailyUsageResponse(parsed)
}

export function useDailyUsageState(
  enabled: boolean,
  refreshKey: unknown,
  days = DEFAULT_USAGE_HEATMAP_DAYS
): DailyUsageState {
  const shouldLoad = enabled
  const [state, setState] = useState<DailyUsageState>({
    usage: null,
    loading: false,
    loaded: false,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    if (!shouldLoad) {
      setState({ usage: null, loading: false, loaded: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const range = defaultDailyUsageRange(new Date(), days)
    void loadDailyUsage(range)
      .then((usage) => {
        if (!cancelled) setState({ usage, loading: false, loaded: true, error: null })
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setState({ usage: null, loading: false, loaded: true, error: message })
        }
      })
    return () => {
      cancelled = true
    }
  }, [days, refreshKey, shouldLoad])

  return state
}
