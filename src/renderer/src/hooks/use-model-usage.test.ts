import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildModelUsagePath,
  loadModelUsage,
  normalizeModelUsageResponse
} from './use-model-usage'

type RuntimeRequest = (path: string, method?: string) => Promise<{ ok: boolean; status: number; body: string }>

function setRuntimeRequest(runtimeRequest: RuntimeRequest): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dsGui: {
        runtimeRequest
      }
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('model usage helpers', () => {
  it('builds an encoded model usage request path', () => {
    expect(
      buildModelUsagePath({
        from: '2026-05-01',
        to: '2026-05-31',
        timezone: 'Asia/Shanghai'
      })
    ).toBe('/v1/usage?group_by=model&from=2026-05-01&to=2026-05-31&timezone=Asia%2FShanghai')
  })

  it('normalizes model buckets and daily chart buckets', () => {
    const normalized = normalizeModelUsageResponse({
      group_by: 'model',
      from: '2026-05-01',
      to: '2026-05-02',
      timezone: 'UTC',
      buckets: [
        {
          model: 'Opus 4.8',
          input_tokens: 100,
          output_tokens: 30,
          total_tokens: 130,
          cache_savings_usd: 0.006,
          cache_savings_cny: 0.0432,
          token_economy_savings_tokens: 2048,
          token_economy_savings_usd: 0.0009,
          token_economy_savings_cny: 0.0063,
          turns: 2,
          thread_count: 1,
          cache_hit_rate: 0.5
        }
      ],
      days: [
        { date: '2026-05-01', total_tokens: 130, turns: 2 },
        { date: '2026-05-02', total_tokens: 0, turns: 0 }
      ],
      totals: { total_tokens: 130, turns: 2, days: 2, active_days: 1, thread_count: 1 }
    })

    expect(normalized.buckets[0]).toMatchObject({
      model: 'Opus 4.8',
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      cacheSavingsUsd: 0.006,
      cacheSavingsCny: 0.0432,
      tokenEconomySavingsTokens: 2048,
      tokenEconomySavingsUsd: 0.0009,
      tokenEconomySavingsCny: 0.0063,
      turns: 2,
      threadCount: 1,
      cacheHitRate: 0.5
    })
    expect(normalized.days.map((bucket) => bucket.date)).toEqual(['2026-05-01', '2026-05-02'])
    expect(normalized.totals.activeDays).toBe(1)
  })

  it('loads model usage from the runtime request bridge', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'model',
        from: '2026-05-01',
        to: '2026-05-01',
        timezone: 'UTC',
        buckets: [{ model: 'Opus 4.8', total_tokens: 10, turns: 1 }],
        days: [{ date: '2026-05-01', total_tokens: 10, turns: 1 }],
        totals: { total_tokens: 10, turns: 1, days: 1, active_days: 1 }
      })
    }))
    setRuntimeRequest(runtimeRequest)

    const loaded = await loadModelUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })

    expect(loaded?.buckets[0]?.model).toBe('Opus 4.8')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/usage?group_by=model&from=2026-05-01&to=2026-05-01&timezone=UTC',
      'GET'
    )
  })

  it('reports invalid JSON model usage responses with a stable error', async () => {
    setRuntimeRequest(async () => ({ ok: true, status: 200, body: '{bad-json' }))

    await expect(
      loadModelUsage({ from: '2026-05-01', to: '2026-05-01', timezone: 'UTC' })
    ).rejects.toThrow('model usage response was not valid JSON')
  })
})
