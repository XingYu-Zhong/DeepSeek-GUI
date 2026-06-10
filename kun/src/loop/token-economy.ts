import type { TurnItem } from '../contracts/items.js'
import type { ModelRequest, ModelToolSpec } from '../ports/model-client.js'
import type { RequestHistoryHygieneOptions } from './request-history-hygiene.js'

export type TokenEconomyConfig = {
  enabled?: boolean
  compressToolDescriptions?: boolean
  compressToolResults?: boolean
  conciseResponses?: boolean
  historyHygiene?: RequestHistoryHygieneOptions
}

export type NormalizedTokenEconomyConfig = Required<
  Omit<TokenEconomyConfig, 'historyHygiene'>
> & {
  historyHygiene: RequestHistoryHygieneOptions
}

export const DEFAULT_TOKEN_ECONOMY_CONFIG: NormalizedTokenEconomyConfig = {
  enabled: false,
  compressToolDescriptions: true,
  compressToolResults: true,
  conciseResponses: true,
  // Safety net that bounds the combined size of all tool results in the
  // sent history, independent of the `enabled` flag (request hygiene runs
  // unconditionally). This prevents a long session from accumulating
  // hundreds of tool results into a multi-hundred-thousand-token request.
  historyHygiene: {
    maxCumulativeToolResultTokens: 120_000,
    keepRecentToolResults: 4
  }
}

export const TOKEN_ECONOMY_INSTRUCTION = [
  'Token economy mode is enabled.',
  'Reply concisely: answer directly, skip pleasantries, filler, and hedging.',
  'Preserve exact code, commands, paths, URLs, identifiers, and quoted errors.',
  'When tool output says content was omitted, use narrower read/grep/bash ranges instead of guessing.'
].join('\n')

const MAX_COMMAND_LINES = 180
const MAX_COMMAND_BYTES = 24 * 1024
const MAX_READ_LINES = 320
const MAX_READ_BYTES = 32 * 1024
const MAX_GENERIC_TEXT_LINES = 220
const MAX_GENERIC_TEXT_BYTES = 24 * 1024
const MAX_GREP_MATCHES = 80
const MAX_FIND_MATCHES = 160
const MAX_LS_ENTRIES = 120
const MAX_ARRAY_ITEMS = 80
const MAX_LINE_CHARS = 260
const ESC = String.fromCharCode(27)
const PROTECTED_SEGMENT_PREFIX = '__KUN_PROTECTED_SEGMENT_'
const PROTECTED_SEGMENT_SUFFIX = '__'

const SIGNAL_LINE_RE =
  /\b(error|failed?|fatal|panic|exception|traceback|warning|warn|denied|timeout|timed out|not found|cannot|invalid)\b/i
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const FILLERS_RE =
  /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally|generally)\b/gi
const PLEASANTRIES_RE =
  /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?\s*/gi
const HEDGES_RE =
  /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b\s*/gi
const LEADERS_RE =
  /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)\s+/gim
const ARTICLES_RE = /\b(?:a|an|the)\s+(?=[a-z])/gi
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\bhttps?:\/\/\S+/gi,
  /\b[\w.-]*[/\\][\w./\\-]+/g,
  /\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b/g,
  /\b\w+\.\w+(?:\.\w+)*\(\)?/g,
  /[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g,
  /\b\d+\.\d+\.\d+\b/g
]

type JsonRecord = Record<string, unknown>

export function normalizeTokenEconomyConfig(
  input: TokenEconomyConfig | undefined
): NormalizedTokenEconomyConfig {
  return {
    ...DEFAULT_TOKEN_ECONOMY_CONFIG,
    ...(input ?? {}),
    historyHygiene: {
      ...DEFAULT_TOKEN_ECONOMY_CONFIG.historyHygiene,
      ...(input?.historyHygiene ?? {})
    }
  }
}

export function applyTokenEconomyToRequest(
  request: ModelRequest,
  config: TokenEconomyConfig | undefined
): ModelRequest {
  const economy = normalizeTokenEconomyConfig(config)
  if (!economy.enabled) return request
  return {
    ...request,
    contextInstructions: economy.conciseResponses
      ? [...(request.contextInstructions ?? []), TOKEN_ECONOMY_INSTRUCTION]
      : request.contextInstructions,
    tools: economy.compressToolDescriptions
      ? request.tools.map(compactToolSpec)
      : request.tools,
    history: economy.compressToolResults
      ? request.history.map(compactHistoryItem)
      : request.history
  }
}

export function compactToolSpec(tool: ModelToolSpec): ModelToolSpec {
  return {
    ...tool,
    description: compressProse(tool.description),
    inputSchema: compactSchemaDescriptions(tool.inputSchema) as Record<string, unknown>
  }
}

export function compactHistoryItem(item: TurnItem): TurnItem {
  switch (item.kind) {
    case 'tool_call': {
      const summary = item.summary ? compressProse(item.summary) : item.summary
      return summary === item.summary ? item : { ...item, summary }
    }
    case 'tool_result':
      return {
        ...item,
        output: compactToolOutput(item.toolName, item.output)
      }
    case 'user_input':
      return {
        ...item,
        questions: item.questions.map((question) => ({
          ...question,
          question: compressProse(question.question),
          options: question.options.map((option) => ({
            ...option,
            description: compressProse(option.description)
          }))
        }))
      }
    default:
      return item
  }
}

export function compressProse(text: string): string {
  if (!text.trim()) return text
  return withProtectedSegments(text, (value) => {
    let out = value
    out = out.replace(LEADERS_RE, '')
    out = out.replace(PLEASANTRIES_RE, '')
    out = out.replace(HEDGES_RE, '')
    out = out.replace(FILLERS_RE, '')
    out = out.replace(ARTICLES_RE, '')
    out = out.replace(/[ \t]{2,}/g, ' ')
    out = out.replace(/\s+([,.;:!?])/g, '$1')
    out = out.replace(/\n{3,}/g, '\n\n')
    out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix: string, ch: string) => prefix + ch.toUpperCase())
    return out.trim()
  })
}

function withProtectedSegments(text: string, transform: (text: string) => string): string {
  const segments: string[] = []
  let working = text
  for (const pattern of PROTECTED_PATTERNS) {
    working = working.replace(pattern, (match) => {
      const index = segments.length
      segments.push(match)
      return `${PROTECTED_SEGMENT_PREFIX}${index}${PROTECTED_SEGMENT_SUFFIX}`
    })
  }
  const markerRe = new RegExp(`${PROTECTED_SEGMENT_PREFIX}(\\d+)${PROTECTED_SEGMENT_SUFFIX}`, 'g')
  return transform(working).replace(markerRe, (_match, index: string) => {
    return segments[Number(index)] ?? ''
  })
}

function compactSchemaDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchemaDescriptions)
  if (!isRecord(value)) return value
  const out: JsonRecord = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === 'description' && typeof child === 'string'
      ? compressProse(child)
      : compactSchemaDescriptions(child)
  }
  return out
}

function compactToolOutput(toolName: string, output: unknown): unknown {
  if (typeof output === 'string') {
    return compactGenericText(output)
  }
  if (!isRecord(output)) return output
  switch (toolName) {
    case 'bash':
      return compactBashOutput(output)
    case 'read':
      return compactReadOutput(output)
    case 'grep':
      return compactGrepOutput(output)
    case 'find':
      return compactFindOutput(output)
    case 'ls':
      return compactLsOutput(output)
    default:
      return compactGenericValue(output)
  }
}

function compactBashOutput(output: JsonRecord): JsonRecord {
  return {
    ...output,
    output: typeof output.output === 'string'
      ? compactCommandOutput(output.output, Boolean(output.full_output_path))
      : output.output
  }
}

function compactReadOutput(output: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...output }
  if (typeof next.content === 'string') {
    next.content = compactHeadText(next.content, {
      maxLines: MAX_READ_LINES,
      maxBytes: MAX_READ_BYTES,
      label: 'file content'
    })
  }
  if (typeof next.data_base64 === 'string') {
    next.data_base64 = `[base64 image data omitted by token economy: ${next.data_base64.length} chars]`
  }
  return next
}

function compactGrepOutput(output: JsonRecord): JsonRecord {
  const matches = Array.isArray(output.matches) ? output.matches : []
  return {
    ...output,
    matches: matches.slice(0, MAX_GREP_MATCHES).map(compactGrepMatch),
    token_economy_omitted_matches:
      matches.length > MAX_GREP_MATCHES ? matches.length - MAX_GREP_MATCHES : undefined
  }
}

function compactGrepMatch(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    text: typeof value.text === 'string' ? compactLine(value.text) : value.text,
    context_before: compactContextLines(value.context_before),
    context_after: compactContextLines(value.context_after)
  }
}

function compactFindOutput(output: JsonRecord): JsonRecord {
  const matches = Array.isArray(output.matches) ? output.matches : []
  return {
    ...output,
    matches: matches.slice(0, MAX_FIND_MATCHES),
    token_economy_omitted_matches:
      matches.length > MAX_FIND_MATCHES ? matches.length - MAX_FIND_MATCHES : undefined
  }
}

function compactLsOutput(output: JsonRecord): JsonRecord {
  const entries = Array.isArray(output.entries) ? output.entries : []
  const names = Array.isArray(output.names) ? output.names : []
  return {
    ...output,
    entries: entries.slice(0, MAX_LS_ENTRIES),
    names: names.slice(0, MAX_LS_ENTRIES),
    token_economy_omitted_entries:
      entries.length > MAX_LS_ENTRIES ? entries.length - MAX_LS_ENTRIES : undefined
  }
}

function compactGenericValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (key === 'description') return compressProse(value)
    if (key === 'data_base64') return `[base64 data omitted by token economy: ${value.length} chars]`
    if (isLargeText(value)) return compactGenericText(value)
    return value
  }
  if (Array.isArray(value)) {
    const mapped = value.slice(0, MAX_ARRAY_ITEMS).map((item) => compactGenericValue(item))
    if (value.length > MAX_ARRAY_ITEMS) {
      mapped.push({ token_economy_omitted_items: value.length - MAX_ARRAY_ITEMS })
    }
    return mapped
  }
  if (!isRecord(value)) return value
  const out: JsonRecord = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = compactGenericValue(childValue, childKey)
  }
  return out
}

function compactContextLines(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.slice(0, 2).map((line) => (typeof line === 'string' ? compactLine(line) : line))
}

function compactCommandOutput(text: string, hasFullOutputPath: boolean): string {
  const normalized = normalizeTextBlock(text)
  if (fitsTextBudget(normalized, MAX_COMMAND_LINES, MAX_COMMAND_BYTES)) return normalized
  const lines = splitLines(normalized)
  const indexes = new Set<number>()
  const headCount = Math.min(24, Math.floor(MAX_COMMAND_LINES * 0.15))
  const tailCount = Math.min(96, Math.floor(MAX_COMMAND_LINES * 0.55))
  for (let index = 0; index < Math.min(headCount, lines.length); index += 1) indexes.add(index)
  for (let index = Math.max(0, lines.length - tailCount); index < lines.length; index += 1) indexes.add(index)
  for (let index = 0; index < lines.length && indexes.size < MAX_COMMAND_LINES; index += 1) {
    if (SIGNAL_LINE_RE.test(lines[index] ?? '')) indexes.add(index)
  }
  const selected = [...indexes].sort((a, b) => a - b).map((index) => compactLine(lines[index] ?? ''))
  const fitted = fitLinesToBudget(selected, MAX_COMMAND_LINES, MAX_COMMAND_BYTES)
  const suffix = hasFullOutputPath
    ? 'full_output_path retained'
    : 'run a narrower command or inspect with read/grep'
  return [
    ...fitted,
    `[token economy: showing ${fitted.length} of ${lines.length} lines; ${suffix}]`
  ].join('\n')
}

function compactGenericText(text: string): string {
  return compactHeadText(text, {
    maxLines: MAX_GENERIC_TEXT_LINES,
    maxBytes: MAX_GENERIC_TEXT_BYTES,
    label: 'text'
  })
}

function compactHeadText(
  text: string,
  options: { maxLines: number; maxBytes: number; label: string }
): string {
  const normalized = normalizeTextBlock(text)
  if (fitsTextBudget(normalized, options.maxLines, options.maxBytes)) return normalized
  const lines = splitLines(normalized).map(compactLine)
  const fitted = fitLinesToBudget(lines, options.maxLines, options.maxBytes)
  return [
    ...fitted,
    `[token economy: showing first ${fitted.length} of ${lines.length} ${options.label} lines]`
  ].join('\n')
}

function normalizeTextBlock(text: string): string {
  const stripped = text.replace(/\r\n/g, '\n').replace(ANSI_RE, '')
  const lines = stripped.split('\n').map((line) => line.trimEnd())
  const out: string[] = []
  let blankRun = 0
  let previous = ''
  let repeatCount = 0
  const flushRepeat = () => {
    if (repeatCount > 1) out.push(`[previous line repeated ${repeatCount - 1} time(s)]`)
    repeatCount = 0
  }
  for (const line of lines) {
    if (!line.trim()) {
      flushRepeat()
      blankRun += 1
      if (blankRun <= 2) out.push('')
      previous = ''
      continue
    }
    blankRun = 0
    if (line === previous) {
      repeatCount += 1
      continue
    }
    flushRepeat()
    out.push(line)
    previous = line
    repeatCount = 1
  }
  flushRepeat()
  return out.join('\n').trim()
}

function splitLines(text: string): string[] {
  if (!text) return []
  return text.split('\n')
}

function fitsTextBudget(text: string, maxLines: number, maxBytes: number): boolean {
  return splitLines(text).length <= maxLines && Buffer.byteLength(text, 'utf8') <= maxBytes
}

function fitLinesToBudget(lines: string[], maxLines: number, maxBytes: number): string[] {
  const out: string[] = []
  let bytes = 0
  for (const line of lines) {
    if (out.length >= maxLines) break
    const lineBytes = Buffer.byteLength(line, 'utf8') + (out.length > 0 ? 1 : 0)
    if (bytes + lineBytes > maxBytes) break
    out.push(line)
    bytes += lineBytes
  }
  return out
}

function compactLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line.trim()
  const head = Math.floor(MAX_LINE_CHARS * 0.6)
  const tail = MAX_LINE_CHARS - head - 5
  return `${line.slice(0, head).trimEnd()} ... ${line.slice(-tail).trimStart()}`
}

function isLargeText(text: string): boolean {
  return text.length > MAX_GENERIC_TEXT_BYTES || splitLines(text).length > MAX_GENERIC_TEXT_LINES
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
