export type DeepseekCurrencyCosts = {
  costUsd: number
  costCny: number
}

type DeepseekPrice = {
  inputCacheHit: number
  inputCacheMiss: number
  output: number
}

type DeepseekPriceSet = {
  usd: DeepseekPrice
  cny: DeepseekPrice
}

const TOKENS_PER_MILLION = 1_000_000

// Official DeepSeek API prices per 1M tokens. As of 2026-06-02,
// deepseek-chat/deepseek-reasoner are aliases for v4-flash modes.
const DEEPSEEK_V4_PRICES: Record<'flash' | 'pro', DeepseekPriceSet> = {
  flash: {
    usd: {
      inputCacheHit: 0.0028,
      inputCacheMiss: 0.14,
      output: 0.28
    },
    cny: {
      inputCacheHit: 0.02,
      inputCacheMiss: 1,
      output: 2
    }
  },
  pro: {
    usd: {
      inputCacheHit: 0.003625,
      inputCacheMiss: 0.435,
      output: 0.87
    },
    cny: {
      inputCacheHit: 0.025,
      inputCacheMiss: 3,
      output: 6
    }
  }
}

function pricingTierForModel(model: string): keyof typeof DEEPSEEK_V4_PRICES | null {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'deepseek-v4-pro' || normalized.endsWith('/deepseek-v4-pro')) return 'pro'
  if (
    normalized === 'deepseek-v4-flash' ||
    normalized === 'deepseek-chat' ||
    normalized === 'deepseek-reasoner' ||
    normalized.endsWith('/deepseek-v4-flash') ||
    normalized.endsWith('/deepseek-chat') ||
    normalized.endsWith('/deepseek-reasoner')
  ) {
    return 'flash'
  }
  return null
}

function computeCost(
  price: DeepseekPrice,
  cacheHitTokens: number,
  cacheMissTokens: number,
  outputTokens: number
): number {
  return (
    (cacheHitTokens / TOKENS_PER_MILLION) * price.inputCacheHit +
    (cacheMissTokens / TOKENS_PER_MILLION) * price.inputCacheMiss +
    (outputTokens / TOKENS_PER_MILLION) * price.output
  )
}

export function estimateDeepseekCost(input: {
  model: string
  cacheHitTokens: number
  cacheMissTokens: number
  outputTokens: number
}): DeepseekCurrencyCosts | null {
  const tier = pricingTierForModel(input.model)
  if (!tier) return null
  const prices = DEEPSEEK_V4_PRICES[tier]
  return {
    costUsd: computeCost(prices.usd, input.cacheHitTokens, input.cacheMissTokens, input.outputTokens),
    costCny: computeCost(prices.cny, input.cacheHitTokens, input.cacheMissTokens, input.outputTokens)
  }
}

export function estimateDeepseekInputTokenCost(input: {
  model: string
  inputTokens: number
}): DeepseekCurrencyCosts | null {
  return estimateDeepseekCost({
    model: input.model,
    cacheHitTokens: 0,
    cacheMissTokens: input.inputTokens,
    outputTokens: 0
  })
}

export function estimateDeepseekCacheSavings(input: {
  model: string
  cacheHitTokens: number
}): DeepseekCurrencyCosts | null {
  const tier = pricingTierForModel(input.model)
  if (!tier) return null
  const prices = DEEPSEEK_V4_PRICES[tier]
  return {
    costUsd: (input.cacheHitTokens / TOKENS_PER_MILLION) *
      Math.max(0, prices.usd.inputCacheMiss - prices.usd.inputCacheHit),
    costCny: (input.cacheHitTokens / TOKENS_PER_MILLION) *
      Math.max(0, prices.cny.inputCacheMiss - prices.cny.inputCacheHit)
  }
}
