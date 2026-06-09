import { makeUserItem } from '../domain/item.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'

export const AUTO_MODEL_ROUTER_MODEL = 'deepseek-v4-flash'
export const AUTO_MODEL_FLASH = 'deepseek-v4-flash'
export const AUTO_MODEL_PRO = 'deepseek-v4-pro'
export const AUTO_MODEL_ROUTER_TIMEOUT_MS = 4_000

export type AutoModelRouteSource = 'flash-router' | 'heuristic'
export type AutoRouteReasoningEffort = 'off' | 'high' | 'max'

export type AutoModelRouteSelection = {
  model: typeof AUTO_MODEL_FLASH | typeof AUTO_MODEL_PRO
  reasoningEffort?: AutoRouteReasoningEffort
  source: AutoModelRouteSource
}

export const AUTO_MODEL_ROUTER_SYSTEM_PROMPT = [
  'You are the DeepSeek TUI auto-routing classifier. Return only compact JSON:',
  '{"model":"deepseek-v4-flash|deepseek-v4-pro","thinking":"off|high|max"}.',
  'Use deepseek-v4-flash for trivial, conversational, status, or single-step work.',
  'Use deepseek-v4-pro for coding, debugging, release work, multi-step tasks, high-risk decisions, tool-heavy work, ambiguous requests, or anything that benefits from deeper reasoning.',
  'Use thinking off only for trivial no-tool answers, high for ordinary reasoning, and max for agentic, coding, multi-file, release, architecture, debugging, security, tool-heavy, or uncertain work.'
].join(' ')

export async function resolveAutoModelRoute(input: {
  modelClient: ModelClient
  threadId: string
  turnId: string
  latestRequest: string
  recentContext: string
  selectedModelMode: string
  abortSignal: AbortSignal
  timeoutMs?: number
}): Promise<AutoModelRouteSelection> {
  const fallback = fallbackAutoRoute(input.latestRequest, input.selectedModelMode)
  if (input.abortSignal.aborted) return fallback

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? AUTO_MODEL_ROUTER_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  input.abortSignal.addEventListener('abort', onAbort, { once: true })

  try {
    const request: ModelRequest = {
      threadId: input.threadId,
      turnId: `${input.turnId}_auto_router`,
      model: AUTO_MODEL_ROUTER_MODEL,
      systemPrompt: AUTO_MODEL_ROUTER_SYSTEM_PROMPT,
      prefix: [],
      history: [
        makeUserItem({
          id: `item_${input.turnId}_auto_router_user`,
          threadId: input.threadId,
          turnId: `${input.turnId}_auto_router`,
          text: autoRoutePrompt({
            latestRequest: input.latestRequest,
            recentContext: input.recentContext,
            selectedModelMode: input.selectedModelMode
          })
        })
      ],
      tools: [],
      abortSignal: controller.signal,
      stream: false,
      maxTokens: 96,
      temperature: 0,
      responseFormat: 'json_object',
      reasoningEffort: 'off'
    }
    const text = await collectRouterText(input.modelClient.stream(request), controller.signal)
    const recommendation = parseAutoRouteRecommendation(text)
    return recommendation ? { ...recommendation, source: 'flash-router' } : fallback
  } catch {
    return fallback
  } finally {
    clearTimeout(timeout)
    input.abortSignal.removeEventListener('abort', onAbort)
  }
}

export function autoModelHeuristic(input: string, _currentModel = ''): typeof AUTO_MODEL_FLASH | typeof AUTO_MODEL_PRO {
  const len = [...input].length
  const lower = input.toLowerCase()
  const complexKeywords = [
    'refactor',
    'architecture',
    'design',
    'debug',
    'security',
    'review',
    'audit',
    'migrate',
    'optimize',
    'rewrite',
    'implement',
    'analyze'
  ]
  if (complexKeywords.some((keyword) => lower.includes(keyword))) {
    return AUTO_MODEL_PRO
  }
  if (len < 100) return AUTO_MODEL_FLASH
  if (len > 500) return AUTO_MODEL_PRO
  return AUTO_MODEL_FLASH
}

export function parseAutoRouteRecommendation(raw: string): {
  model: typeof AUTO_MODEL_FLASH | typeof AUTO_MODEL_PRO
  reasoningEffort?: AutoRouteReasoningEffort
} | null {
  const json = extractFirstJsonObject(raw)
  if (!json) return null
  try {
    const value = JSON.parse(json) as { effort?: unknown; model?: unknown; reasoning_effort?: unknown; thinking?: unknown }
    const model = typeof value.model === 'string' ? normalizeAutoRouteModel(value.model) : null
    if (!model) return null
    const rawEffort = [value.thinking, value.reasoning_effort, value.effort]
      .find((effort) => typeof effort === 'string')
    const reasoningEffort = typeof rawEffort === 'string' ? normalizeAutoRouteEffort(rawEffort) : undefined
    return {
      model,
      ...(reasoningEffort ? { reasoningEffort } : {})
    }
  } catch {
    return null
  }
}

export function recentAutoRouterContext(items: readonly TurnItem[], currentTurnId: string): string {
  const rows: string[] = []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (rows.length >= 6) break
    const item = items[index]
    if (item.turnId === currentTurnId) continue
    const text = routerTextForItem(item).trim()
    if (!text) continue
    rows.push(`${routerRoleForItem(item)}: ${truncateForAutoRouter(text, 900)}`)
  }
  rows.reverse()
  return rows.length ? rows.join('\n') : 'No prior context.'
}

function fallbackAutoRoute(
  latestRequest: string,
  selectedModelMode: string
): AutoModelRouteSelection {
  return {
    model: autoModelHeuristic(latestRequest, selectedModelMode),
    reasoningEffort: autoReasoningHeuristic(latestRequest),
    source: 'heuristic'
  }
}

function autoRoutePrompt(input: {
  latestRequest: string
  recentContext: string
  selectedModelMode: string
}): string {
  return [
    'Session mode: agent',
    `Selected model mode: ${input.selectedModelMode}`,
    'Selected thinking mode: auto',
    '',
    'Recent context:',
    input.recentContext,
    '',
    'Latest user request:',
    input.latestRequest,
    '',
    'Return JSON only.'
  ].join('\n')
}

async function collectRouterText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('auto model router timed out')
    switch (chunk.kind) {
      case 'assistant_text_delta':
      case 'assistant_reasoning_delta':
        text += chunk.text
        break
      case 'error':
        throw new Error(chunk.message)
    }
  }
  return text
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

function normalizeAutoRouteModel(model: string): typeof AUTO_MODEL_FLASH | typeof AUTO_MODEL_PRO | null {
  switch (model.trim().toLowerCase()) {
    case 'deepseek-v4-pro':
    case 'v4-pro':
    case 'pro':
      return AUTO_MODEL_PRO
    case 'deepseek-v4-flash':
    case 'v4-flash':
    case 'flash':
      return AUTO_MODEL_FLASH
    default:
      return null
  }
}

function normalizeAutoRouteEffort(effort: string): AutoRouteReasoningEffort | null {
  switch (effort.trim().toLowerCase()) {
    case 'off':
    case 'disabled':
    case 'none':
    case 'false':
      return 'off'
    case 'low':
    case 'minimal':
    case 'medium':
    case 'mid':
    case 'high':
      return 'high'
    case 'max':
    case 'maximum':
    case 'xhigh':
      return 'max'
    default:
      return null
  }
}

function autoReasoningHeuristic(input: string): AutoRouteReasoningEffort {
  const lower = input.toLowerCase()
  return lower.includes('debug') || lower.includes('error') ? 'max' : 'high'
}

function routerRoleForItem(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
      return 'user'
    case 'tool_result':
      return 'tool'
    case 'compaction':
      return 'system'
    default:
      return 'assistant'
  }
}

function routerTextForItem(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_text':
    case 'assistant_reasoning':
      return item.text
    case 'tool_call':
      return `[tool call: ${item.toolName}]`
    case 'tool_result':
      return `[tool result] ${typeof item.output === 'string' ? item.output : JSON.stringify(item.output)}`
    case 'compaction':
      return item.summary
    case 'approval':
      return `[approval: ${item.toolName}] ${item.summary}`
    case 'user_input':
      return `[user input] ${item.prompt}`
    case 'review':
      return `[review] ${item.title} ${item.reviewText ?? ''}`
    case 'error':
      return `[error] ${item.message}`
  }
}

function truncateForAutoRouter(text: string, maxChars: number): string {
  const chars = [...text]
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}...` : text
}
