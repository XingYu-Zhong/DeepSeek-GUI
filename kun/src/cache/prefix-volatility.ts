import type { TurnItem } from '../contracts/items.js'
import type { ImmutablePrefix } from './immutable-prefix.js'

export type PrefixVolatilityKind = 'uuid' | 'iso8601' | 'hex_hash' | 'jwt'

export type PrefixVolatilityFinding = {
  field: 'systemPrompt' | 'fewShots'
  kind: PrefixVolatilityKind
  token: string
  itemId?: string
}

const HASH_LENGTHS = new Set([32, 40, 64])
const UUID_SEGMENT_LENGTHS = [8, 4, 4, 4, 12] as const
const BOUNDARY_PUNCTUATION = '.,;:!?()[]{}<>"\'`'

/**
 * Detector-only volatility scan for immutable prompt-cache prefixes.
 *
 * Intentionally no regex: UUIDs, dashless UUIDs, MD5/SHA hashes, ISO dates,
 * and JWT-looking strings have overlapping shapes. Keep this as structured
 * token parsing so false positives are easier to debug.
 */
export function detectVolatilePrefixContent(prefix: ImmutablePrefix): PrefixVolatilityFinding[] {
  return [
    ...detectVolatileTokens('systemPrompt', prefix.systemPrompt),
    ...prefix.fewShots.flatMap((item) => detectVolatileFewShotItem(item))
  ]
}

function detectVolatileFewShotItem(item: TurnItem): PrefixVolatilityFinding[] {
  const text = fewShotText(item)
  if (!text) return []
  return detectVolatileTokens('fewShots', text, item.id)
}

function fewShotText(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_text':
    case 'assistant_reasoning':
      return item.text
    case 'tool_call':
      return `${item.toolName} ${stableStringify(item.arguments)}`
    case 'tool_result':
      return `${item.toolName} ${stableStringify(item.output)}`
    case 'approval':
      return `${item.toolName} ${item.summary}`
    case 'user_input':
      return item.prompt
    case 'compaction':
      return item.summary
    case 'review':
      return `${item.title} ${item.reviewText ?? ''} ${stableStringify(item.output ?? {})}`
    case 'error':
      return item.message
  }
}

function detectVolatileTokens(
  field: PrefixVolatilityFinding['field'],
  content: string,
  itemId?: string
): PrefixVolatilityFinding[] {
  const findings: PrefixVolatilityFinding[] = []
  for (const rawToken of splitTokens(content)) {
    const token = stripBoundaryPunctuation(rawToken)
    if (!token) continue
    const kind = volatileTokenKind(token)
    if (!kind) continue
    findings.push({ field, kind, token, ...(itemId ? { itemId } : {}) })
  }
  return findings
}

function volatileTokenKind(token: string): PrefixVolatilityKind | null {
  if (isCanonicalUuid(token)) return 'uuid'
  if (isIso8601(token)) return 'iso8601'
  if (isHexHash(token)) return 'hex_hash'
  if (isJwt(token)) return 'jwt'
  return null
}

function splitTokens(content: string): string[] {
  const tokens: string[] = []
  let current = ''
  for (const char of content) {
    if (isWhitespace(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function stripBoundaryPunctuation(token: string): string {
  let start = 0
  let end = token.length
  while (start < end && BOUNDARY_PUNCTUATION.includes(token[start] ?? '')) start += 1
  while (end > start && BOUNDARY_PUNCTUATION.includes(token[end - 1] ?? '')) end -= 1
  return token.slice(start, end)
}

function isCanonicalUuid(token: string): boolean {
  if (token.length !== 36) return false
  const parts = token.split('-')
  if (parts.length !== 5) return false
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? ''
    if (part.length !== UUID_SEGMENT_LENGTHS[index]) return false
    if (!isHexString(part)) return false
  }
  return true
}

function isIso8601(token: string): boolean {
  if (token.length < 10) return false
  if (token[4] !== '-' || token[7] !== '-') return false
  const year = parseFixedInt(token.slice(0, 4))
  const month = parseFixedInt(token.slice(5, 7))
  const day = parseFixedInt(token.slice(8, 10))
  if (year === null || month === null || day === null) return false
  if (token.length > 10) {
    const separator = token[10]
    if (separator !== 'T' && separator !== ' ') return false
  }
  const parsed = Date.parse(token)
  if (!Number.isFinite(parsed)) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function isHexHash(token: string): boolean {
  return HASH_LENGTHS.has(token.length) && isHexString(token)
}

function isJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  if (!parts.every((part) => part.length > 0 && isBase64UrlString(part))) return false
  return isJsonObject(decodeBase64UrlJson(parts[0] ?? '')) &&
    isJsonObject(decodeBase64UrlJson(parts[1] ?? ''))
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f' || char === '\v'
}

function parseFixedInt(value: string): number | null {
  if (!isDigitString(value)) return null
  return Number.parseInt(value, 10)
}

function isDigitString(value: string): boolean {
  if (!value) return false
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 48 || code > 57) return false
  }
  return true
}

function isHexString(value: string): boolean {
  if (!value) return false
  for (const char of value) {
    const code = char.charCodeAt(0)
    const numeric = code >= 48 && code <= 57
    const upper = code >= 65 && code <= 70
    const lower = code >= 97 && code <= 102
    if (!numeric && !upper && !lower) return false
  }
  return true
}

function isBase64UrlString(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    const numeric = code >= 48 && code <= 57
    const upper = code >= 65 && code <= 90
    const lower = code >= 97 && code <= 122
    if (!numeric && !upper && !lower && char !== '-' && char !== '_' && char !== '=') return false
  }
  return true
}

function decodeBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function isJsonObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(stableShape(value))
  } catch {
    return String(value)
  }
}

function stableShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableShape)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = stableShape((value as Record<string, unknown>)[key])
  }
  return out
}
