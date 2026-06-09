import { useEffect, useState } from 'react'
import { parseUsageResponse } from './usage-response'

export type ThreadUsageSummary = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
}

export type ThreadUsageState = {
  usage: ThreadUsageSummary | null
  loading: boolean
  loaded: boolean
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat().format(value)
}

function isChineseLocale(locale?: string): boolean {
  const normalized = (locale ?? '').trim().toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}

function fallbackLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en'
}

function formatMoneyValue(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  return safeValue.toFixed(safeValue >= 1 ? 2 : 4)
}

export function formatCost(costUsd: number, locale = fallbackLocale(), costCny?: number | null): string {
  if (isChineseLocale(locale)) {
    const safeUsd = Number.isFinite(costUsd) ? costUsd : 0
    const value = typeof costCny === 'number' && Number.isFinite(costCny) ? costCny : safeUsd * 7.2
    return `￥${formatMoneyValue(value)}`
  }
  return `$${formatMoneyValue(costUsd)}`
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = Math.max(0, Math.min(100, value * 100))
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

type CacheStats = {
  hitTokens: number
  missTokens: number
}

async function loadThreadCacheStats(threadId: string): Promise<CacheStats | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const r = await window.dsGui.runtimeRequest(
    `/v1/threads/${encodeURIComponent(threadId)}`,
    'GET'
  )
  if (!r.ok || !r.body.trim()) return null
  const parsed = parseUsageResponse<{
    turns?: Array<{ usage?: Record<string, unknown> | null }>
  }>(r.body, 'thread detail')
  let hitTokens = 0
  let missTokens = 0
  let hasCacheTelemetry = false

  for (const turn of parsed.turns ?? []) {
    const usage = turn.usage
    if (!usage || typeof usage !== 'object') continue
    const hasHit = hasFiniteNumber(usage, 'prompt_cache_hit_tokens')
    const hasMiss = hasFiniteNumber(usage, 'prompt_cache_miss_tokens')
    if (!hasHit && !hasMiss) continue
    hasCacheTelemetry = true
    const hit = hasHit ? usageNumber(usage.prompt_cache_hit_tokens) : 0
    const miss = hasMiss ? usageNumber(usage.prompt_cache_miss_tokens) : 0
    hitTokens += hit
    missTokens += miss
  }

  return hasCacheTelemetry ? { hitTokens, missTokens } : null
}

export async function loadThreadUsage(threadId: string): Promise<ThreadUsageSummary | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const [r, cacheStats] = await Promise.all([
    window.dsGui.runtimeRequest('/v1/usage?group_by=thread', 'GET'),
    loadThreadCacheStats(threadId).catch(() => null)
  ])
  if (!r.ok || !r.body.trim()) return null
  const parsed = parseUsageResponse<{
    buckets?: Array<Record<string, unknown>>
  }>(r.body, 'thread usage')
  const bucket = parsed.buckets?.find((item) => {
    const candidates = [item.thread_id, item.key, item.id, item.label]
    return candidates.some((candidate) => candidate === threadId)
  })
  if (!bucket) return null
  const inputTokens = usageNumber(bucket.input_tokens)
  const outputTokens = usageNumber(bucket.output_tokens)
  const reasoningTokens = usageNumber(bucket.reasoning_tokens)
  const bucketCacheHitRate = usageRate(bucket.cache_hit_rate)
  const hasBucketCacheTelemetry = bucketCacheHitRate !== null
  const cachedTokens = cacheStats
    ? cacheStats.hitTokens
    : hasBucketCacheTelemetry
      ? usageNumber(bucket.cached_tokens)
      : 0
  const cacheMissTokens = cacheStats
    ? cacheStats.missTokens
    : hasBucketCacheTelemetry
      ? usageNumber(bucket.cache_miss_tokens)
      : 0
  const cacheTotal = cachedTokens + cacheMissTokens
  const cacheHitRate = cacheStats
    ? cacheTotal > 0 ? cachedTokens / cacheTotal : null
    : bucketCacheHitRate
  const totalTokens = inputTokens + outputTokens
  const costUsd = usageNumber(bucket.cost_usd)
  const costCny = hasFiniteNumber(bucket, 'cost_cny') ? usageNumber(bucket.cost_cny) : null
  const cacheSavingsUsd = usageNumber(bucket.cache_savings_usd)
  const cacheSavingsCny = hasFiniteNumber(bucket, 'cache_savings_cny') ? usageNumber(bucket.cache_savings_cny) : null
  const tokenEconomySavingsTokens = usageNumber(bucket.token_economy_savings_tokens)
  const tokenEconomySavingsUsd = usageNumber(bucket.token_economy_savings_usd)
  const tokenEconomySavingsCny = hasFiniteNumber(bucket, 'token_economy_savings_cny')
    ? usageNumber(bucket.token_economy_savings_cny)
    : null
  const turns = usageNumber(bucket.turns)
  if (
    totalTokens <= 0 &&
    cachedTokens <= 0 &&
    costUsd <= 0 &&
    (costCny ?? 0) <= 0 &&
    cacheSavingsUsd <= 0 &&
    (cacheSavingsCny ?? 0) <= 0 &&
    tokenEconomySavingsTokens <= 0 &&
    tokenEconomySavingsUsd <= 0 &&
    (tokenEconomySavingsCny ?? 0) <= 0 &&
    turns <= 0
  ) return null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    totalTokens,
    costUsd,
    costCny,
    cacheSavingsUsd,
    cacheSavingsCny,
    tokenEconomySavingsTokens,
    tokenEconomySavingsUsd,
    tokenEconomySavingsCny,
    turns
  }
}

export function useThreadUsageState(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageState {
  const [state, setState] = useState<ThreadUsageState>({
    usage: null,
    loading: false,
    loaded: false
  })

  useEffect(() => {
    let cancelled = false
    if (!threadId || !enabled) {
      setState({ usage: null, loading: false, loaded: false })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    void loadThreadUsage(threadId)
      .then((usage) => {
        if (!cancelled) setState({ usage, loading: false, loaded: true })
      })
      .catch(() => {
        if (!cancelled) setState({ usage: null, loading: false, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, refreshKey, threadId])

  return state
}

export function useThreadUsage(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageSummary | null {
  return useThreadUsageState(threadId, enabled, refreshKey).usage
}
