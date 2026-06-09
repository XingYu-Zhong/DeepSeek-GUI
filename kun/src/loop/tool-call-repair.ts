import type { ToolCallLike } from '../ports/tool-host.js'

export type ToolCallArgumentRepairOptions = {
  toolName?: string
  toolKind?: ToolCallLike['toolKind']
  maxStringBytes?: number
}

export type ToolCallArgumentRepairResult = {
  arguments: Record<string, unknown>
  notes: string[]
}

const DEFAULT_MAX_STRING_BYTES = 512 * 1024
const WRAPPER_KEYS = ['arguments', 'args', 'input', 'parameters', 'params', 'payload', '__raw']
const TOOL_METADATA_KEYS = new Set([
  'tool',
  'toolName',
  'tool_name',
  'name',
  'id',
  'callId',
  'call_id',
  'type'
])

/**
 * Provider-neutral repair pass for already-parsed tool arguments.
 *
 * Model adapters repair JSON strings while parsing provider payloads; this
 * boundary pass catches provider-agnostic shapes that can still reach the
 * loop as Records, such as `{ arguments: "{\"path\":\"a.ts\"}" }`.
 */
export function repairDispatchToolArguments(
  raw: Record<string, unknown>,
  options: ToolCallArgumentRepairOptions = {}
): ToolCallArgumentRepairResult {
  const notes: string[] = []
  let current = shallowCloneRecord(raw)

  const flattened = flattenWrapper(current)
  if (flattened) {
    current = flattened.arguments
    notes.push(flattened.note)
  } else {
    const scavenged = scavengeSingleJsonString(current)
    if (scavenged) {
      current = scavenged.arguments
      notes.push(scavenged.note)
    }
  }

  const truncated = truncateOversizedStrings(current, {
    maxStringBytes: options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES,
    preserveLongStrings: options.toolKind === 'file_change'
  })
  if (truncated.changed) {
    current = truncated.value
    notes.push(`truncated ${truncated.count} oversized argument string(s)`)
  }

  return { arguments: current, notes }
}

function shallowCloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value }
}

function flattenWrapper(
  raw: Record<string, unknown>
): { arguments: Record<string, unknown>; note: string } | null {
  for (const key of WRAPPER_KEYS) {
    if (!(key in raw)) continue
    if (!canFlattenWrapper(raw, key)) continue
    const value = raw[key]
    const parsed = valueToObject(value)
    if (!parsed) continue
    return {
      arguments: parsed,
      note: `flattened ${key} wrapper`
    }
  }
  return null
}

function canFlattenWrapper(raw: Record<string, unknown>, wrapperKey: string): boolean {
  const keys = Object.keys(raw)
  if (keys.length === 1) return true
  return keys.every((key) => key === wrapperKey || TOOL_METADATA_KEYS.has(key))
}

function scavengeSingleJsonString(
  raw: Record<string, unknown>
): { arguments: Record<string, unknown>; note: string } | null {
  const entries = Object.entries(raw)
  if (entries.length !== 1) return null
  const [key, value] = entries[0] ?? []
  if (!key || typeof value !== 'string') return null
  const parsed = parseJsonishObject(value)
  if (!parsed) return null
  return {
    arguments: parsed,
    note: `scavenged JSON object from ${key}`
  }
}

function valueToObject(value: unknown): Record<string, unknown> | null {
  if (isPlainObject(value)) return { ...value }
  if (typeof value === 'string') return parseJsonishObject(value)
  return null
}

function parseJsonishObject(text: string): Record<string, unknown> | null {
  const candidates = [
    text.trim(),
    stripMarkdownFence(text.trim()),
    extractFirstJsonObject(text)
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return { ...parsed }
    } catch {
      // Try the next repair candidate.
    }
  }
  return null
}

function truncateOversizedStrings(
  value: Record<string, unknown>,
  options: { maxStringBytes: number; preserveLongStrings: boolean }
): { value: Record<string, unknown>; changed: boolean; count: number } {
  if (options.preserveLongStrings) return { value, changed: false, count: 0 }
  const state = { changed: false, count: 0 }
  const next = truncateValue(value, options.maxStringBytes, state)
  return {
    value: isPlainObject(next) ? next : value,
    changed: state.changed,
    count: state.count
  }
}

function truncateValue(
  value: unknown,
  maxBytes: number,
  state: { changed: boolean; count: number }
): unknown {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
    state.changed = true
    state.count += 1
    return `${sliceUtf8(value, maxBytes)}\n...[truncated by Kun tool argument repair]`
  }
  if (Array.isArray(value)) return value.map((item) => truncateValue(item, maxBytes, state))
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = truncateValue(child, maxBytes, state)
  }
  return out
}

function stripMarkdownFence(text: string): string {
  const fence = /^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return fence?.[1]?.trim() ?? text
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function sliceUtf8(value: string, maxBytes: number): string {
  let used = 0
  let out = ''
  for (const char of value) {
    const next = Buffer.byteLength(char, 'utf8')
    if (used + next > maxBytes) break
    out += char
    used += next
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
