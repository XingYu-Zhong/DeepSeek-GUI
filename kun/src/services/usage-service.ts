import { UsageCounter } from '../telemetry/usage-counter.js'
import { CacheTelemetry } from '../telemetry/cache-telemetry.js'
import type {
  DailyUsageBucket,
  DailyUsageCounters,
  DailyUsageResponse,
  ModelUsageBucket,
  ModelUsageResponse,
  ThreadUsageBucket,
  ThreadUsageResponse,
  UsageSnapshot
} from '../contracts/usage.js'

/**
 * Coordinates usage and cache telemetry. The service records each
 * model response and returns the cumulative snapshot for the loop to
 * forward as a `usage` runtime event.
 */
export class UsageService {
  private readonly counter = new UsageCounter()
  private readonly cache = new CacheTelemetry()

  record(threadId: string, usage: UsageSnapshot): UsageSnapshot {
    this.cache.ingest(threadId, usage)
    return this.counter.record(threadId, usage)
  }

  recordTokenEconomySavings(
    threadId: string,
    savings: Pick<
      UsageSnapshot,
      'tokenEconomySavingsTokens' | 'tokenEconomySavingsUsd' | 'tokenEconomySavingsCny'
    >
  ): UsageSnapshot {
    return this.counter.recordTokenEconomySavings(threadId, savings)
  }

  seedThread(threadId: string, usage: UsageSnapshot): UsageSnapshot {
    const seeded = this.counter.seed(threadId, usage)
    this.cache.reset(threadId)
    this.cache.ingest(threadId, seeded)
    return seeded
  }

  forThread(threadId: string): UsageSnapshot {
    return this.counter.forThread(threadId)
  }

  total(): UsageSnapshot {
    return this.counter.total()
  }

  cacheSnapshot(threadId: string) {
    return this.cache.snapshot(threadId)
  }

  reset(threadId?: string): void {
    this.counter.reset(threadId)
    this.cache.reset(threadId)
  }
}

export const MAX_DAILY_USAGE_DAYS = 370

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export class UsageValidationError extends Error {
  readonly code = 'validation_error'

  constructor(message: string) {
    super(message)
    this.name = 'UsageValidationError'
  }
}

export type DailyUsageQuery = {
  groupBy: 'day'
  from: string
  to: string
  timezone: string
}

export type ModelUsageQuery = {
  groupBy: 'model'
  from: string
  to: string
  timezone: string
}

export type ThreadUsageRecord = {
  threadId: string
  model?: string
  completedAt: string
  usage: UsageSnapshot
}

type DailyUsageAccumulator = DailyUsageBucket & {
  threadIds: Set<string>
  hasCacheTelemetry: boolean
}

type ThreadUsageAccumulator = ThreadUsageBucket & {
  hasCacheTelemetry: boolean
}

type ModelUsageAccumulator = ModelUsageBucket & {
  threadIds: Set<string>
  hasCacheTelemetry: boolean
}

type UsageCountersTarget = Pick<
  DailyUsageCounters,
  | 'input_tokens'
  | 'output_tokens'
  | 'reasoning_tokens'
  | 'cached_tokens'
  | 'cache_miss_tokens'
  | 'total_tokens'
  | 'cost_usd'
  | 'cost_cny'
  | 'cache_savings_usd'
  | 'cache_savings_cny'
  | 'token_economy_savings_tokens'
  | 'token_economy_savings_usd'
  | 'token_economy_savings_cny'
  | 'turns'
>

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
  } catch {
    throw new UsageValidationError(`invalid timezone: ${timezone}`)
  }
}

function parseDateString(value: string, field: string): Date {
  if (!DATE_RE.test(value)) {
    throw new UsageValidationError(`${field} must use YYYY-MM-DD`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new UsageValidationError(`${field} must be a valid calendar date`)
  }
  return date
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function inclusiveDayCount(from: string, to: string): number {
  const start = parseDateString(from, 'from')
  const end = parseDateString(to, 'to')
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days <= 0) {
    throw new UsageValidationError('from must be on or before to')
  }
  if (days > MAX_DAILY_USAGE_DAYS) {
    throw new UsageValidationError(`daily usage range must be ${MAX_DAILY_USAGE_DAYS} days or less`)
  }
  return days
}

function stringParam(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' && first.trim() ? first.trim() : undefined
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseDailyUsageQuery(
  input: Record<string, unknown>,
  runtimeDefaultTimezone = defaultTimezone(),
  now = new Date()
): DailyUsageQuery {
  const groupBy = stringParam(input, 'group_by') ?? 'runtime'
  if (groupBy !== 'day') {
    throw new UsageValidationError(`unsupported usage grouping: ${groupBy}`)
  }
  const timezone = stringParam(input, 'timezone') ?? runtimeDefaultTimezone
  assertValidTimezone(timezone)
  const { from, to } = resolveUsageWindow(input, timezone, now, 'daily usage')
  inclusiveDayCount(from, to)
  return { groupBy: 'day', from, to, timezone }
}

export function parseModelUsageQuery(
  input: Record<string, unknown>,
  runtimeDefaultTimezone = defaultTimezone(),
  now = new Date()
): ModelUsageQuery {
  const groupBy = stringParam(input, 'group_by') ?? 'runtime'
  if (groupBy !== 'model') {
    throw new UsageValidationError(`unsupported usage grouping: ${groupBy}`)
  }
  const timezone = stringParam(input, 'timezone') ?? runtimeDefaultTimezone
  assertValidTimezone(timezone)
  const { from, to } = resolveUsageWindow(input, timezone, now, 'model usage')
  inclusiveDayCount(from, to)
  return { groupBy: 'model', from, to, timezone }
}

function resolveUsageWindow(
  input: Record<string, unknown>,
  timezone: string,
  now: Date,
  label: string
): { from: string; to: string } {
  const from = stringParam(input, 'from')
  const to = stringParam(input, 'to')
  if (from && to) return { from, to }
  if (from || to) throw new UsageValidationError(`${label} requires both from and to`)
  const window = stringParam(input, 'window')?.toLowerCase().replace(/-/g, '_')
  if (!window) throw new UsageValidationError(`${label} requires from and to`)
  const toDate = formatDateInTimezone(now.toISOString(), timezone)
  if (!toDate) throw new UsageValidationError('invalid usage window date')
  const days = (() => {
    switch (window) {
      case 'today':
        return 1
      case 'week':
        return 7
      case 'month':
        return 30
      case 'all':
      case 'all_time':
      case 'alltime':
        return MAX_DAILY_USAGE_DAYS
      default:
        throw new UsageValidationError(`unsupported usage window: ${window}`)
    }
  })()
  return {
    from: dateString(addUtcDays(parseDateString(toDate, 'to'), -(days - 1))),
    to: toDate
  }
}

export function formatDateInTimezone(isoTimestamp: string, timezone: string): string | null {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

function emptyCounters(): DailyUsageCounters {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_miss_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    cost_cny: 0,
    cache_savings_usd: 0,
    cache_savings_cny: 0,
    token_economy_savings_tokens: 0,
    token_economy_savings_usd: 0,
    token_economy_savings_cny: 0,
    turns: 0,
    thread_count: 0,
    cache_hit_rate: null
  }
}

function hasCacheTelemetry(usage: UsageSnapshot): boolean {
  return typeof usage.cacheHitTokens === 'number' || typeof usage.cacheMissTokens === 'number'
}

function addUsageCounters(
  target: UsageCountersTarget,
  usage: UsageSnapshot
): { hasCacheTelemetry: boolean } {
  const cached = typeof usage.cacheHitTokens === 'number' ? usage.cacheHitTokens : 0
  const miss = typeof usage.cacheMissTokens === 'number' ? usage.cacheMissTokens : 0
  target.input_tokens += usage.promptTokens
  target.output_tokens += usage.completionTokens
  target.reasoning_tokens += 0
  target.cached_tokens += cached
  target.cache_miss_tokens += miss
  target.total_tokens += usage.totalTokens
  target.cost_usd += usage.costUsd ?? 0
  target.cost_cny += usage.costCny ?? 0
  target.cache_savings_usd += usage.cacheSavingsUsd ?? 0
  target.cache_savings_cny += usage.cacheSavingsCny ?? 0
  target.token_economy_savings_tokens += usage.tokenEconomySavingsTokens ?? 0
  target.token_economy_savings_usd += usage.tokenEconomySavingsUsd ?? 0
  target.token_economy_savings_cny += usage.tokenEconomySavingsCny ?? 0
  target.turns += usage.turns
  return { hasCacheTelemetry: hasCacheTelemetry(usage) }
}

function finalizeCacheRate<T extends DailyUsageCounters>(
  counters: T,
  hasTelemetry: boolean
): T {
  const cacheTotal = counters.cached_tokens + counters.cache_miss_tokens
  return {
    ...counters,
    cache_hit_rate: hasTelemetry && cacheTotal > 0 ? counters.cached_tokens / cacheTotal : null
  }
}

function emptyDailyBucket(date: string): DailyUsageAccumulator {
  return {
    date,
    ...emptyCounters(),
    threadIds: new Set<string>(),
    hasCacheTelemetry: false
  }
}

function emptyThreadBucket(threadId: string): ThreadUsageAccumulator {
  return {
    thread_id: threadId,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_miss_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    cost_cny: 0,
    cache_savings_usd: 0,
    cache_savings_cny: 0,
    token_economy_savings_tokens: 0,
    token_economy_savings_usd: 0,
    token_economy_savings_cny: 0,
    turns: 0,
    cache_hit_rate: null,
    hasCacheTelemetry: false
  }
}

function emptyModelBucket(model: string): ModelUsageAccumulator {
  return {
    model,
    ...emptyCounters(),
    threadIds: new Set<string>(),
    hasCacheTelemetry: false
  }
}

function finalizeDailyBucket(bucket: DailyUsageAccumulator): DailyUsageBucket {
  const finalized = finalizeCacheRate(bucket, bucket.hasCacheTelemetry)
  return {
    date: finalized.date,
    input_tokens: finalized.input_tokens,
    output_tokens: finalized.output_tokens,
    reasoning_tokens: finalized.reasoning_tokens,
    cached_tokens: finalized.cached_tokens,
    cache_miss_tokens: finalized.cache_miss_tokens,
    total_tokens: finalized.total_tokens,
    cost_usd: finalized.cost_usd,
    cost_cny: finalized.cost_cny,
    cache_savings_usd: finalized.cache_savings_usd,
    cache_savings_cny: finalized.cache_savings_cny,
    token_economy_savings_tokens: finalized.token_economy_savings_tokens,
    token_economy_savings_usd: finalized.token_economy_savings_usd,
    token_economy_savings_cny: finalized.token_economy_savings_cny,
    turns: finalized.turns,
    thread_count: finalized.thread_count,
    cache_hit_rate: finalized.cache_hit_rate
  }
}

function finalizeThreadBucket(bucket: ThreadUsageAccumulator): ThreadUsageBucket {
  const finalized = finalizeCacheRate({ ...bucket, thread_count: 0 }, bucket.hasCacheTelemetry)
  return {
    thread_id: bucket.thread_id,
    input_tokens: finalized.input_tokens,
    output_tokens: finalized.output_tokens,
    reasoning_tokens: finalized.reasoning_tokens,
    cached_tokens: finalized.cached_tokens,
    cache_miss_tokens: finalized.cache_miss_tokens,
    total_tokens: finalized.total_tokens,
    cost_usd: finalized.cost_usd,
    cost_cny: finalized.cost_cny,
    cache_savings_usd: finalized.cache_savings_usd,
    cache_savings_cny: finalized.cache_savings_cny,
    token_economy_savings_tokens: finalized.token_economy_savings_tokens,
    token_economy_savings_usd: finalized.token_economy_savings_usd,
    token_economy_savings_cny: finalized.token_economy_savings_cny,
    turns: finalized.turns,
    cache_hit_rate: finalized.cache_hit_rate
  }
}

function finalizeModelBucket(bucket: ModelUsageAccumulator): ModelUsageBucket {
  const finalized = finalizeCacheRate(bucket, bucket.hasCacheTelemetry)
  return {
    model: bucket.model,
    input_tokens: finalized.input_tokens,
    output_tokens: finalized.output_tokens,
    reasoning_tokens: finalized.reasoning_tokens,
    cached_tokens: finalized.cached_tokens,
    cache_miss_tokens: finalized.cache_miss_tokens,
    total_tokens: finalized.total_tokens,
    cost_usd: finalized.cost_usd,
    cost_cny: finalized.cost_cny,
    cache_savings_usd: finalized.cache_savings_usd,
    cache_savings_cny: finalized.cache_savings_cny,
    token_economy_savings_tokens: finalized.token_economy_savings_tokens,
    token_economy_savings_usd: finalized.token_economy_savings_usd,
    token_economy_savings_cny: finalized.token_economy_savings_cny,
    turns: finalized.turns,
    thread_count: bucket.threadIds.size,
    cache_hit_rate: finalized.cache_hit_rate
  }
}

export function buildThreadUsageResponse(records: readonly ThreadUsageRecord[]): ThreadUsageResponse {
  const buckets = new Map<string, ThreadUsageAccumulator>()
  for (const record of records) {
    const bucket = buckets.get(record.threadId) ?? emptyThreadBucket(record.threadId)
    const added = addUsageCounters(bucket, record.usage)
    bucket.hasCacheTelemetry = bucket.hasCacheTelemetry || added.hasCacheTelemetry
    buckets.set(record.threadId, bucket)
  }
  const finalized = [...buckets.values()]
    .map(finalizeThreadBucket)
    .sort((a, b) => b.total_tokens - a.total_tokens || a.thread_id.localeCompare(b.thread_id))
  const totalsBase = finalized.reduce(
    (acc, bucket) => {
      acc.input_tokens += bucket.input_tokens
      acc.output_tokens += bucket.output_tokens
      acc.reasoning_tokens += bucket.reasoning_tokens
      acc.cached_tokens += bucket.cached_tokens
      acc.cache_miss_tokens += bucket.cache_miss_tokens
      acc.total_tokens += bucket.total_tokens
      acc.cost_usd += bucket.cost_usd
      acc.cost_cny += bucket.cost_cny
      acc.cache_savings_usd += bucket.cache_savings_usd
      acc.cache_savings_cny += bucket.cache_savings_cny
      acc.token_economy_savings_tokens += bucket.token_economy_savings_tokens
      acc.token_economy_savings_usd += bucket.token_economy_savings_usd
      acc.token_economy_savings_cny += bucket.token_economy_savings_cny
      acc.turns += bucket.turns
      return acc
    },
    { ...emptyCounters(), thread_count: finalized.length }
  )
  const totals = finalizeCacheRate(
    totalsBase,
    [...buckets.values()].some((bucket) => bucket.hasCacheTelemetry)
  )
  return { group_by: 'thread', buckets: finalized, totals }
}

export function buildDailyUsageResponse(
  records: readonly ThreadUsageRecord[],
  query: DailyUsageQuery
): DailyUsageResponse {
  const days = inclusiveDayCount(query.from, query.to)
  assertValidTimezone(query.timezone)
  const start = parseDateString(query.from, 'from')
  const buckets = new Map<string, DailyUsageAccumulator>()
  for (let offset = 0; offset < days; offset += 1) {
    const day = dateString(addUtcDays(start, offset))
    buckets.set(day, emptyDailyBucket(day))
  }

  for (const record of records) {
    const day = formatDateInTimezone(record.completedAt, query.timezone)
    if (!day) continue
    const bucket = buckets.get(day)
    if (!bucket) continue
    const added = addUsageCounters(bucket, record.usage)
    bucket.threadIds.add(record.threadId)
    bucket.thread_count = bucket.threadIds.size
    bucket.hasCacheTelemetry = bucket.hasCacheTelemetry || added.hasCacheTelemetry
  }

  const finalized = [...buckets.values()].map(finalizeDailyBucket)
  const threadIds = new Set<string>()
  const totalsBase = finalized.reduce(
    (acc, bucket) => {
      acc.input_tokens += bucket.input_tokens
      acc.output_tokens += bucket.output_tokens
      acc.reasoning_tokens += bucket.reasoning_tokens
      acc.cached_tokens += bucket.cached_tokens
      acc.cache_miss_tokens += bucket.cache_miss_tokens
      acc.total_tokens += bucket.total_tokens
      acc.cost_usd += bucket.cost_usd
      acc.cost_cny += bucket.cost_cny
      acc.cache_savings_usd += bucket.cache_savings_usd
      acc.cache_savings_cny += bucket.cache_savings_cny
      acc.token_economy_savings_tokens += bucket.token_economy_savings_tokens
      acc.token_economy_savings_usd += bucket.token_economy_savings_usd
      acc.token_economy_savings_cny += bucket.token_economy_savings_cny
      acc.turns += bucket.turns
      if (
        bucket.turns > 0 ||
        bucket.total_tokens > 0 ||
        bucket.cost_usd > 0 ||
        bucket.cost_cny > 0 ||
        bucket.token_economy_savings_tokens > 0
      ) {
        acc.active_days += 1
      }
      const accumulator = buckets.get(bucket.date)
      if (accumulator) {
        for (const threadId of accumulator.threadIds) threadIds.add(threadId)
      }
      return acc
    },
    { ...emptyCounters(), days, active_days: 0 }
  )
  totalsBase.thread_count = threadIds.size
  const totals = finalizeCacheRate(
    totalsBase,
    [...buckets.values()].some((bucket) => bucket.hasCacheTelemetry)
  )

  return {
    group_by: 'day',
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    buckets: finalized,
    totals
  }
}

export function buildModelUsageResponse(
  records: readonly ThreadUsageRecord[],
  query: ModelUsageQuery
): ModelUsageResponse {
  const days = inclusiveDayCount(query.from, query.to)
  assertValidTimezone(query.timezone)
  const start = parseDateString(query.from, 'from')
  const dayBuckets = new Map<string, DailyUsageAccumulator>()
  const modelBuckets = new Map<string, ModelUsageAccumulator>()
  for (let offset = 0; offset < days; offset += 1) {
    const day = dateString(addUtcDays(start, offset))
    dayBuckets.set(day, emptyDailyBucket(day))
  }

  for (const record of records) {
    const day = formatDateInTimezone(record.completedAt, query.timezone)
    if (!day) continue
    const dayBucket = dayBuckets.get(day)
    if (!dayBucket) continue

    const model = record.model?.trim() || 'unknown'
    const modelBucket = modelBuckets.get(model) ?? emptyModelBucket(model)
    const dayAdded = addUsageCounters(dayBucket, record.usage)
    const modelAdded = addUsageCounters(modelBucket, record.usage)
    dayBucket.threadIds.add(record.threadId)
    dayBucket.thread_count = dayBucket.threadIds.size
    dayBucket.hasCacheTelemetry = dayBucket.hasCacheTelemetry || dayAdded.hasCacheTelemetry
    modelBucket.threadIds.add(record.threadId)
    modelBucket.thread_count = modelBucket.threadIds.size
    modelBucket.hasCacheTelemetry = modelBucket.hasCacheTelemetry || modelAdded.hasCacheTelemetry
    modelBuckets.set(model, modelBucket)
  }

  const finalizedDays = [...dayBuckets.values()].map(finalizeDailyBucket)
  const finalizedModels = [...modelBuckets.values()]
    .map(finalizeModelBucket)
    .sort((a, b) => b.total_tokens - a.total_tokens || a.model.localeCompare(b.model))
  const totalsBase = finalizedDays.reduce(
    (acc, bucket) => {
      acc.input_tokens += bucket.input_tokens
      acc.output_tokens += bucket.output_tokens
      acc.reasoning_tokens += bucket.reasoning_tokens
      acc.cached_tokens += bucket.cached_tokens
      acc.cache_miss_tokens += bucket.cache_miss_tokens
      acc.total_tokens += bucket.total_tokens
      acc.cost_usd += bucket.cost_usd
      acc.cost_cny += bucket.cost_cny
      acc.cache_savings_usd += bucket.cache_savings_usd
      acc.cache_savings_cny += bucket.cache_savings_cny
      acc.token_economy_savings_tokens += bucket.token_economy_savings_tokens
      acc.token_economy_savings_usd += bucket.token_economy_savings_usd
      acc.token_economy_savings_cny += bucket.token_economy_savings_cny
      acc.turns += bucket.turns
      if (
        bucket.turns > 0 ||
        bucket.total_tokens > 0 ||
        bucket.cost_usd > 0 ||
        bucket.cost_cny > 0 ||
        bucket.token_economy_savings_tokens > 0
      ) {
        acc.active_days += 1
      }
      return acc
    },
    { ...emptyCounters(), days, active_days: 0 }
  )
  const threadIds = new Set<string>()
  for (const bucket of modelBuckets.values()) {
    for (const threadId of bucket.threadIds) threadIds.add(threadId)
  }
  totalsBase.thread_count = threadIds.size
  const totals = finalizeCacheRate(
    totalsBase,
    [...modelBuckets.values()].some((bucket) => bucket.hasCacheTelemetry)
  )

  return {
    group_by: 'model',
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    buckets: finalizedModels,
    days: finalizedDays,
    totals
  }
}
