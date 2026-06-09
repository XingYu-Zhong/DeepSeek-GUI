import { useEffect, useState } from 'react'
import {
  type DailyUsageBucket,
  type DailyUsageRange,
  defaultDailyUsageRange
} from './use-daily-usage'
import { parseUsageResponse } from './usage-response'

export type ModelUsageBucket = Omit<DailyUsageBucket, 'date'> & {
  model: string
}

export type ModelUsageSummary = {
  groupBy: 'model'
  from: string
  to: string
  timezone: string
  buckets: ModelUsageBucket[]
  days: DailyUsageBucket[]
  totals: Omit<DailyUsageBucket, 'date'> & {
    days: number
    activeDays: number
  }
}

export type ModelUsageState = {
  usage: ModelUsageSummary | null
  loading: boolean
  loaded: boolean
  error: string | null
}

type RawUsageCounters = {
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

type RawModelUsageBucket = RawUsageCounters & {
  model?: unknown
}

type RawModelUsageDayBucket = RawUsageCounters & {
  date?: unknown
}

type RawModelUsageResponse = {
  group_by?: unknown
  from?: unknown
  to?: unknown
  timezone?: unknown
  buckets?: unknown
  days?: unknown
  totals?: unknown
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

function normalizeCounters(raw: RawUsageCounters): Omit<DailyUsageBucket, 'date'> {
  const inputTokens = usageNumber(raw.input_tokens)
  const outputTokens = usageNumber(raw.output_tokens)
  const totalTokens = usageNumber(raw.total_tokens) || inputTokens + outputTokens
  return {
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

function normalizeModelBucket(raw: RawModelUsageBucket): ModelUsageBucket {
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unknown'
  return {
    model,
    ...normalizeCounters(raw)
  }
}

function normalizeDayBucket(raw: RawModelUsageDayBucket): DailyUsageBucket {
  return {
    date: typeof raw.date === 'string' ? raw.date : '',
    ...normalizeCounters(raw)
  }
}

function normalizeTotals(raw: RawUsageCounters & { days?: unknown; active_days?: unknown }): ModelUsageSummary['totals'] {
  return {
    ...normalizeCounters(raw),
    days: usageNumber(raw.days),
    activeDays: usageNumber(raw.active_days)
  }
}

export function buildModelUsagePath(range: DailyUsageRange): string {
  const params = new URLSearchParams()
  params.set('group_by', 'model')
  params.set('from', range.from)
  params.set('to', range.to)
  params.set('timezone', range.timezone)
  return `/v1/usage?${params.toString()}`
}

export function normalizeModelUsageResponse(raw: RawModelUsageResponse): ModelUsageSummary {
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets.map((item) => normalizeModelBucket((item ?? {}) as RawModelUsageBucket))
    : []
  const days = Array.isArray(raw.days)
    ? raw.days
        .map((item) => normalizeDayBucket((item ?? {}) as RawModelUsageDayBucket))
        .filter((bucket) => bucket.date)
    : []
  return {
    groupBy: 'model',
    from: typeof raw.from === 'string' ? raw.from : days[0]?.date ?? '',
    to: typeof raw.to === 'string' ? raw.to : days[days.length - 1]?.date ?? '',
    timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : '',
    buckets,
    days,
    totals: normalizeTotals((raw.totals ?? {}) as RawUsageCounters & { days?: unknown; active_days?: unknown })
  }
}

export async function loadModelUsage(range: DailyUsageRange): Promise<ModelUsageSummary | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const response = await window.dsGui.runtimeRequest(buildModelUsagePath(range), 'GET')
  if (!response.ok || !response.body.trim()) {
    throw new Error(`model usage request failed: ${response.status}`)
  }
  const parsed = parseUsageResponse<RawModelUsageResponse>(response.body, 'model usage')
  if (parsed.group_by !== 'model') {
    throw new Error('model usage response did not use model grouping')
  }
  return normalizeModelUsageResponse(parsed)
}

export function useModelUsageState(enabled: boolean, refreshKey: unknown, days: number): ModelUsageState {
  const [state, setState] = useState<ModelUsageState>({
    usage: null,
    loading: false,
    loaded: false,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setState({ usage: null, loading: false, loaded: false, error: null })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    const range = defaultDailyUsageRange(new Date(), days)
    void loadModelUsage(range)
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
  }, [days, enabled, refreshKey])

  return state
}
