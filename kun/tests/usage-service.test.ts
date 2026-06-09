import { describe, expect, it } from 'vitest'
import { DailyUsageResponseSchema, ModelUsageResponseSchema, ThreadUsageResponseSchema } from '../src/contracts/usage.js'
import {
  MAX_DAILY_USAGE_DAYS,
  UsageService,
  UsageValidationError,
  buildDailyUsageResponse,
  buildModelUsageResponse,
  buildThreadUsageResponse,
  formatDateInTimezone,
  parseDailyUsageQuery,
  parseModelUsageQuery,
  type ThreadUsageRecord
} from '../src/services/usage-service.js'

function usage(overrides: Partial<ThreadUsageRecord['usage']> = {}): ThreadUsageRecord['usage'] {
  return {
    promptTokens: 100,
    completionTokens: 40,
    totalTokens: 140,
    cachedTokens: 30,
    cacheHitTokens: 30,
    cacheMissTokens: 70,
    cacheHitRate: 0.3,
    turns: 1,
    costUsd: 0.02,
    costCny: 0.14,
    cacheSavingsUsd: 0.01,
    cacheSavingsCny: 0.07,
    tokenEconomySavingsTokens: 50,
    tokenEconomySavingsUsd: 0.005,
    tokenEconomySavingsCny: 0.035,
    ...overrides
  }
}

describe('daily usage service', () => {
  it('seeds cached usage carryover and continues accumulating new turns', () => {
    const service = new UsageService()

    service.seedThread('thr_seed', usage({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 80,
      cacheHitTokens: 80,
      cacheMissTokens: 20,
      turns: 2,
      costUsd: 0.01,
      costCny: 0.07,
      cacheSavingsUsd: 0.005,
      cacheSavingsCny: 0.035,
      tokenEconomySavingsTokens: 40,
      tokenEconomySavingsUsd: 0.004,
      tokenEconomySavingsCny: 0.028
    }))
    const after = service.record('thr_seed', usage({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedTokens: 9,
      cacheHitTokens: 9,
      cacheMissTokens: 1,
      turns: 1,
      costUsd: 0.002,
      costCny: 0.014,
      cacheSavingsUsd: 0.001,
      cacheSavingsCny: 0.007,
      tokenEconomySavingsTokens: 10,
      tokenEconomySavingsUsd: 0.001,
      tokenEconomySavingsCny: 0.007
    }))

    expect(after.promptTokens).toBe(110)
    expect(after.cacheHitTokens).toBe(89)
    expect(after.cacheMissTokens).toBe(21)
    expect(after.cacheHitRate).toBeCloseTo(89 / 110)
    expect(after.turns).toBe(3)
    expect(after.tokenEconomySavingsTokens).toBe(50)
    expect(service.total().costUsd).toBeCloseTo(0.012)
    expect(service.total().cacheSavingsUsd).toBeCloseTo(0.006)
    expect(service.total().tokenEconomySavingsUsd).toBeCloseTo(0.005)
    expect(service.cacheSnapshot('thr_seed')).toMatchObject({
      hits: 89,
      misses: 21,
      hitRate: 89 / 110
    })
  })

  it('records token economy savings without counting an extra model turn', () => {
    const service = new UsageService()

    service.record('thr_savings', usage({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
      turns: 1,
      tokenEconomySavingsTokens: 0,
      tokenEconomySavingsUsd: 0,
      tokenEconomySavingsCny: 0
    }))
    const after = service.recordTokenEconomySavings('thr_savings', {
      tokenEconomySavingsTokens: 8000,
      tokenEconomySavingsUsd: 0.00348,
      tokenEconomySavingsCny: 0.024
    })

    expect(after.turns).toBe(1)
    expect(after.totalTokens).toBe(15)
    expect(after.tokenEconomySavingsTokens).toBe(8000)
    expect(after.tokenEconomySavingsUsd).toBeCloseTo(0.00348)
    expect(after.tokenEconomySavingsCny).toBeCloseTo(0.024)
  })

  it('does not guess cache hit telemetry from cachedTokens-only carryover', () => {
    const service = new UsageService()

    service.seedThread('thr_unknown_cache', usage({
      cachedTokens: 42,
      cacheHitTokens: undefined,
      cacheMissTokens: undefined,
      cacheHitRate: null
    }))

    expect(service.forThread('thr_unknown_cache')).toMatchObject({
      cachedTokens: 42,
      cacheHitRate: null
    })
    expect(service.forThread('thr_unknown_cache').cacheHitTokens).toBeUndefined()
    expect(service.forThread('thr_unknown_cache').cacheMissTokens).toBeUndefined()
    expect(service.cacheSnapshot('thr_unknown_cache')).toMatchObject({
      hits: 0,
      misses: 0,
      hitRate: null
    })
  })

  it('parses a valid daily usage query with explicit timezone', () => {
    expect(
      parseDailyUsageQuery({
        group_by: 'day',
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      })
    ).toEqual({
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-31',
      timezone: 'Asia/Shanghai'
    })
  })

  it('rejects unsupported grouping and invalid ranges', () => {
    expect(() => parseDailyUsageQuery({ group_by: 'week' })).toThrow(UsageValidationError)
    expect(() =>
      parseDailyUsageQuery({ group_by: 'day', from: '2026-06-02', to: '2026-06-01' })
    ).toThrow('from must be on or before to')
    expect(() =>
      parseDailyUsageQuery({ group_by: 'day', from: '2026-01-01', to: '2027-01-10' })
    ).toThrow(`${MAX_DAILY_USAGE_DAYS} days or less`)
  })

  it('uses the runtime default timezone when timezone is omitted', () => {
    const parsed = parseDailyUsageQuery(
      { group_by: 'day', from: '2026-06-01', to: '2026-06-01' },
      'UTC'
    )

    expect(parsed.timezone).toBe('UTC')
  })

  it('expands rolling usage windows in the requested timezone', () => {
    const parsed = parseDailyUsageQuery(
      { group_by: 'day', window: 'week', timezone: 'Asia/Shanghai' },
      'UTC',
      new Date('2026-06-03T16:30:00.000Z')
    )

    expect(parsed).toEqual({
      groupBy: 'day',
      from: '2026-05-29',
      to: '2026-06-04',
      timezone: 'Asia/Shanghai'
    })
  })

  it('parses a valid model usage query with explicit timezone', () => {
    expect(
      parseModelUsageQuery({
        group_by: 'model',
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      })
    ).toEqual({
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-31',
      timezone: 'Asia/Shanghai'
    })
  })

  it('groups turns by the requested timezone', () => {
    expect(formatDateInTimezone('2026-05-01T16:30:00.000Z', 'Asia/Shanghai')).toBe('2026-05-02')
  })

  it('returns contiguous buckets, zero days, totals, and thread counts', () => {
    const response = buildDailyUsageResponse(
      [
        {
          threadId: 'thr_a',
          completedAt: '2026-05-01T10:00:00.000Z',
          usage: usage()
        },
        {
          threadId: 'thr_b',
          completedAt: '2026-05-03T10:00:00.000Z',
          usage: usage({ promptTokens: 50, completionTokens: 10, totalTokens: 60, turns: 2 })
        }
      ],
      { groupBy: 'day', from: '2026-05-01', to: '2026-05-03', timezone: 'UTC' }
    )

    expect(DailyUsageResponseSchema.parse(response)).toEqual(response)
    expect(response.buckets.map((bucket) => bucket.date)).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03'
    ])
    expect(response.buckets[1]).toMatchObject({
      total_tokens: 0,
      turns: 0,
      thread_count: 0
    })
    expect(response.totals).toMatchObject({
      total_tokens: 200,
      turns: 3,
      thread_count: 2,
      days: 3,
      active_days: 2,
      cache_savings_usd: 0.02
    })
  })

  it('keeps cache hit rate unknown when cache telemetry is absent', () => {
    const response = buildDailyUsageResponse(
      [
        {
          threadId: 'thr_a',
          completedAt: '2026-05-01T10:00:00.000Z',
          usage: usage({
            cachedTokens: undefined,
            cacheHitTokens: undefined,
            cacheMissTokens: undefined,
            cacheHitRate: null
          })
        }
      ],
      { groupBy: 'day', from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' }
    )

    expect(response.buckets[0]?.cache_hit_rate).toBeNull()
    expect(response.totals.cache_hit_rate).toBeNull()
  })

  it('does not treat cachedTokens-only usage as cache hits in aggregate buckets', () => {
    const cachedTokensOnly = usage({
      cachedTokens: 42,
      cacheHitTokens: undefined,
      cacheMissTokens: undefined,
      cacheHitRate: null
    })
    const records: ThreadUsageRecord[] = [
      {
        threadId: 'thr_unknown_cache',
        model: 'Opus 4.8',
        completedAt: '2026-05-01T10:00:00.000Z',
        usage: cachedTokensOnly
      }
    ]

    const threadResponse = buildThreadUsageResponse(records)
    const dailyResponse = buildDailyUsageResponse(records, {
      groupBy: 'day',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC'
    })
    const modelResponse = buildModelUsageResponse(records, {
      groupBy: 'model',
      from: '2026-05-01',
      to: '2026-05-01',
      timezone: 'UTC'
    })

    for (const counters of [
      threadResponse.buckets[0],
      threadResponse.totals,
      dailyResponse.buckets[0],
      dailyResponse.totals,
      modelResponse.buckets[0],
      modelResponse.totals
    ]) {
      expect(counters?.cached_tokens).toBe(0)
      expect(counters?.cache_miss_tokens).toBe(0)
      expect(counters?.cache_hit_rate).toBeNull()
    }
  })

  it('preserves thread-grouped usage buckets alongside daily grouping', () => {
    const response = buildThreadUsageResponse([
      {
        threadId: 'thr_b',
        completedAt: '2026-05-01T10:00:00.000Z',
        usage: usage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
      },
      {
        threadId: 'thr_a',
        completedAt: '2026-05-01T10:00:00.000Z',
        usage: usage({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
      },
      {
        threadId: 'thr_b',
        completedAt: '2026-05-02T10:00:00.000Z',
        usage: usage({ promptTokens: 30, completionTokens: 10, totalTokens: 40 })
      }
    ])

    expect(ThreadUsageResponseSchema.parse(response)).toEqual(response)
    expect(response.group_by).toBe('thread')
    expect(response.buckets.map((bucket) => bucket.thread_id)).toEqual(['thr_a', 'thr_b'])
    expect(response.buckets[1]).toMatchObject({
      input_tokens: 40,
      output_tokens: 15,
      total_tokens: 55,
      turns: 2
    })
    expect(response.totals).toMatchObject({
      total_tokens: 175,
      thread_count: 2,
      turns: 3,
      cache_savings_usd: 0.03
    })
  })

  it('groups usage by model with daily bars and model totals', () => {
    const response = buildModelUsageResponse(
      [
        {
          threadId: 'thr_a',
          model: 'Opus 4.8',
          completedAt: '2026-05-01T10:00:00.000Z',
          usage: usage({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
        },
        {
          threadId: 'thr_b',
          model: 'Opus 4.7',
          completedAt: '2026-05-02T10:00:00.000Z',
          usage: usage({ promptTokens: 40, completionTokens: 10, totalTokens: 50 })
        },
        {
          threadId: 'thr_c',
          model: 'Opus 4.8',
          completedAt: '2026-05-02T12:00:00.000Z',
          usage: usage({ promptTokens: 60, completionTokens: 30, totalTokens: 90 })
        }
      ],
      { groupBy: 'model', from: '2026-05-01', to: '2026-05-03', timezone: 'UTC' }
    )

    expect(ModelUsageResponseSchema.parse(response)).toEqual(response)
    expect(response.group_by).toBe('model')
    expect(response.days.map((bucket) => bucket.date)).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03'
    ])
    expect(response.days.map((bucket) => bucket.total_tokens)).toEqual([120, 140, 0])
    expect(response.buckets.map((bucket) => bucket.model)).toEqual(['Opus 4.8', 'Opus 4.7'])
    expect(response.buckets[0]).toMatchObject({
      input_tokens: 160,
      output_tokens: 50,
      total_tokens: 210,
      thread_count: 2
    })
    expect(response.totals).toMatchObject({
      total_tokens: 260,
      active_days: 2,
      thread_count: 3
    })
  })
})
