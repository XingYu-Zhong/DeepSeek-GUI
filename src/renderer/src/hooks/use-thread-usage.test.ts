import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCost, loadThreadUsage } from './use-thread-usage'

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

describe('thread usage formatting', () => {
  it('uses RMB for Chinese locales and USD for English locales', () => {
    expect(formatCost(0.125, 'zh', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'zh-CN', 0.88)).toBe('￥0.8800')
    expect(formatCost(0.125, 'en')).toBe('$0.1250')
  })

  it('keeps cache hit rate unknown for cachedTokens-only thread usage buckets', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === '/v1/usage?group_by=thread') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_cached_only',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cached_tokens: 42,
                cache_hit_rate: null,
                turns: 1
              }
            ]
          })
        }
      }
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          turns: [
            {
              usage: {
                cached_tokens: 42
              }
            }
          ]
        })
      }
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_cached_only')

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: null
    })
  })

  it('uses explicit aggregate thread cache telemetry when available', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === '/v1/usage?group_by=thread') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_aggregate_cache',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cache_savings_usd: 0.003,
                cache_savings_cny: 0.0216,
                token_economy_savings_tokens: 4096,
                token_economy_savings_usd: 0.0018,
                token_economy_savings_cny: 0.0126,
                cached_tokens: 40,
                cache_miss_tokens: 60,
                cache_hit_rate: 0.4,
                turns: 1
              }
            ]
          })
        }
      }
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ turns: [] })
      }
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_aggregate_cache')

    expect(usage).toMatchObject({
      cachedTokens: 40,
      cacheMissTokens: 60,
      cacheHitRate: 0.4,
      cacheSavingsUsd: 0.003,
      cacheSavingsCny: 0.0216,
      tokenEconomySavingsTokens: 4096,
      tokenEconomySavingsUsd: 0.0018,
      tokenEconomySavingsCny: 0.0126
    })
  })

  it('uses explicit thread cache hit and miss telemetry when available', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === '/v1/usage?group_by=thread') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_native_cache',
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                cached_tokens: 0,
                cache_hit_rate: null,
                turns: 1
              }
            ]
          })
        }
      }
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          turns: [
            {
              usage: {
                prompt_cache_hit_tokens: 80,
                prompt_cache_miss_tokens: 20,
                input_tokens: 100
              }
            }
          ]
        })
      }
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_native_cache')

    expect(usage).toMatchObject({
      cachedTokens: 80,
      cacheMissTokens: 20,
      cacheHitRate: 0.8
    })
  })

  it('reports invalid JSON thread usage responses with a stable error', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === '/v1/usage?group_by=thread') {
        return { ok: true, status: 200, body: '{bad-json' }
      }
      return { ok: true, status: 200, body: JSON.stringify({ turns: [] }) }
    })
    setRuntimeRequest(runtimeRequest)

    await expect(loadThreadUsage('thr_bad_json')).rejects.toThrow(
      'thread usage response was not valid JSON'
    )
  })

  it('continues without thread cache stats when thread detail JSON is invalid', async () => {
    const runtimeRequest = vi.fn<RuntimeRequest>(async (path) => {
      if (path === '/v1/usage?group_by=thread') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            buckets: [
              {
                thread_id: 'thr_invalid_detail_json',
                input_tokens: 100,
                output_tokens: 20,
                cached_tokens: 40,
                cache_miss_tokens: 60,
                cache_hit_rate: 0.4,
                turns: 1
              }
            ]
          })
        }
      }
      return { ok: true, status: 200, body: '{bad-json' }
    })
    setRuntimeRequest(runtimeRequest)

    const usage = await loadThreadUsage('thr_invalid_detail_json')

    expect(usage).toMatchObject({
      cachedTokens: 40,
      cacheMissTokens: 60,
      cacheHitRate: 0.4
    })
  })
})
