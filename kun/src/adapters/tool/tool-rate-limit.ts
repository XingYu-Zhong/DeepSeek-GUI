export type ParsedRateLimit = {
  rateLimited: boolean
  message: string
  retryAfterSeconds?: number
}

const RATE_LIMIT_RE =
  /\b(rate[-\s]?limit(?:ed|ing)?|too many requests|quota exceeded|request limit|(?:http|status)\s*:?\s*429)\b/i
const RETRY_AFTER_RE =
  /\b(?:retry[-\s]?after|try again in|wait)\s*:?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?)?\b/i

export function parseRateLimitedToolResult(output: unknown): ParsedRateLimit | null {
  const text = collectText(output).join('\n').trim()
  if (!text || !RATE_LIMIT_RE.test(text)) return null
  const retryAfter = parseRetryAfterSeconds(text)
  return {
    rateLimited: true,
    message: compactRateLimitMessage(text),
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
  }
}

export function normalizeRateLimitedToolOutput(output: unknown): {
  output: unknown
  isError: boolean
  rateLimited: boolean
} {
  const parsed = parseRateLimitedToolResult(output)
  if (!parsed) return { output, isError: false, rateLimited: false }
  return {
    output: {
      code: 'rate_limited',
      rate_limited: true,
      error: parsed.message,
      ...(parsed.retryAfterSeconds !== undefined ? { retry_after_seconds: parsed.retryAfterSeconds } : {}),
      original: output
    },
    isError: true,
    rateLimited: true
  }
}

function collectText(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((entry) => collectText(entry, depth + 1))
  if (typeof value !== 'object') return []
  const out: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
      out.push(`${key}: ${String(child)}`)
      continue
    }
    out.push(...collectText(child, depth + 1))
  }
  return out
}

function parseRetryAfterSeconds(text: string): number | undefined {
  const match = RETRY_AFTER_RE.exec(text)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return undefined
  const unit = (match[2] ?? 's').toLowerCase()
  if (unit.startsWith('ms') || unit.startsWith('millisecond')) return Math.ceil(value / 1000)
  if (unit.startsWith('m') && !unit.startsWith('ms')) return Math.ceil(value * 60)
  return Math.ceil(value)
}

function compactRateLimitMessage(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 360) return compact
  return `${compact.slice(0, 357).trim()}...`
}
