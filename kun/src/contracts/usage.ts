import { z } from 'zod'

/**
 * Token, cache, and cost counters emitted with every model response.
 *
 * `cacheHitTokens`/`cacheMissTokens` are optional because some providers
 * (or older model revisions) do not surface prompt-cache hit counts. When
 * the values are absent, `cacheHitRate` is reported as `null` rather than
 * guessing at zero.
 */
export const UsageSnapshotSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
  turns: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
  cacheSavingsCny: z.number().nonnegative().optional(),
  tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
  tokenEconomySavingsUsd: z.number().nonnegative().optional(),
  tokenEconomySavingsCny: z.number().nonnegative().optional(),
  /** Provider reported an unrecoverable error mid-stream. */
  hasError: z.boolean().optional()
})
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const DailyUsageCountersSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative(),
  cached_tokens: z.number().int().nonnegative(),
  cache_miss_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  cost_cny: z.number().nonnegative(),
  cache_savings_usd: z.number().nonnegative(),
  cache_savings_cny: z.number().nonnegative(),
  token_economy_savings_tokens: z.number().int().nonnegative(),
  token_economy_savings_usd: z.number().nonnegative(),
  token_economy_savings_cny: z.number().nonnegative(),
  turns: z.number().int().nonnegative(),
  thread_count: z.number().int().nonnegative(),
  cache_hit_rate: z.number().min(0).max(1).nullable()
})
export type DailyUsageCounters = z.infer<typeof DailyUsageCountersSchema>

export const DailyUsageBucketSchema = DailyUsageCountersSchema.extend({
  date: DateStringSchema
})
export type DailyUsageBucket = z.infer<typeof DailyUsageBucketSchema>

export const DailyUsageTotalsSchema = DailyUsageCountersSchema.extend({
  days: z.number().int().nonnegative(),
  active_days: z.number().int().nonnegative()
})
export type DailyUsageTotals = z.infer<typeof DailyUsageTotalsSchema>

export const DailyUsageResponseSchema = z.object({
  group_by: z.literal('day'),
  from: DateStringSchema,
  to: DateStringSchema,
  timezone: z.string().min(1),
  buckets: z.array(DailyUsageBucketSchema),
  totals: DailyUsageTotalsSchema
})
export type DailyUsageResponse = z.infer<typeof DailyUsageResponseSchema>

export const ThreadUsageBucketSchema = DailyUsageCountersSchema.omit({
  thread_count: true
}).extend({
  thread_id: z.string().min(1)
})
export type ThreadUsageBucket = z.infer<typeof ThreadUsageBucketSchema>

export const ThreadUsageTotalsSchema = DailyUsageCountersSchema.omit({
  thread_count: true
}).extend({
  thread_count: z.number().int().nonnegative()
})
export type ThreadUsageTotals = z.infer<typeof ThreadUsageTotalsSchema>

export const ThreadUsageResponseSchema = z.object({
  group_by: z.literal('thread'),
  buckets: z.array(ThreadUsageBucketSchema),
  totals: ThreadUsageTotalsSchema
})
export type ThreadUsageResponse = z.infer<typeof ThreadUsageResponseSchema>

export const ModelUsageBucketSchema = DailyUsageCountersSchema.extend({
  model: z.string().min(1)
})
export type ModelUsageBucket = z.infer<typeof ModelUsageBucketSchema>

export const ModelUsageDayBucketSchema = DailyUsageBucketSchema
export type ModelUsageDayBucket = z.infer<typeof ModelUsageDayBucketSchema>

export const ModelUsageResponseSchema = z.object({
  group_by: z.literal('model'),
  from: DateStringSchema,
  to: DateStringSchema,
  timezone: z.string().min(1),
  buckets: z.array(ModelUsageBucketSchema),
  days: z.array(ModelUsageDayBucketSchema),
  totals: DailyUsageTotalsSchema
})
export type ModelUsageResponse = z.infer<typeof ModelUsageResponseSchema>

export const emptyUsageSnapshot = (): UsageSnapshot => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  cacheHitRate: null,
  turns: 0,
  cacheSavingsUsd: 0,
  cacheSavingsCny: 0,
  tokenEconomySavingsTokens: 0,
  tokenEconomySavingsUsd: 0,
  tokenEconomySavingsCny: 0
})
