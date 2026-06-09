import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../ports/model-client.js'
import type { TurnItem } from '../../contracts/items.js'
import { emptyUsageSnapshot, type UsageSnapshot } from '../../contracts/usage.js'
import { estimateDeepseekCacheSavings, estimateDeepseekCost } from './deepseek-pricing.js'
import { isToolResultBridgeItem, repairModelHistoryItems } from '../../domain/model-history-repair.js'
import { repairToolArguments } from './tool-argument-repair.js'
import { isDeepSeekHost, probeDeepSeekReachable } from './model-error-probe.js'

/**
 * Configuration for the DeepSeek-compatible HTTP model client. The
 * client intentionally mirrors the DeepSeek-TUI transport shape:
 * `POST {baseUrl}/v1/chat/completions` with `stream: true`, parsed
 * line-by-line (`data: {json}\n\n`).
 */
export type DeepseekCompatConfig = {
  baseUrl: string
  apiKey: string
  model: string
  /** Optional extra headers, e.g. project or session ids. */
  headers?: Record<string, string>
  /** HTTP fetch implementation. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Maximum number of messages to send. Defaults to the entire history. */
  historyLimit?: number
  /** When true, the client requests a non-streaming response. */
  nonStreaming?: boolean
  /** Maximum idle time between streaming chunks before the turn fails. */
  streamIdleTimeoutMs?: number
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatMessageContentPart[] | null
  name?: string
  tool_call_id?: string
  reasoning_content?: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ChatCompletionResponse = {
  id: string
  model: string
  choices: {
    index: number
    finish_reason: string
    message: ChatMessage & {
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_eval_count?: number
    eval_count?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

type ModelStopReason = Extract<ModelStreamChunk, { kind: 'completed' }>['stopReason']
type PendingToolCall = {
  index?: number
  name?: string
  arguments: string
}
type StreamReadResult =
  | { kind: 'chunk'; value?: Uint8Array; done: boolean }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000

/**
 * DeepSeek-compatible model client.
 *
 * This adapter focuses on the streaming chat completions shape used
 * by the GUI today. It supports tool calls, cache hit/miss counters
 * (when the provider reports them), and abort-signal cancellation.
 * The client is deliberately small so the rest of the runtime can be
 * built around the `ModelClient` port.
 */
export class DeepseekCompatModelClient implements ModelClient {
  readonly provider = 'deepseek-compat'
  readonly model: string

  private readonly config: DeepseekCompatConfig
  private readonly fetchImpl: typeof fetch

  constructor(config: DeepseekCompatConfig) {
    this.config = config
    this.model = config.model
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  /**
   * Streams the model response for a turn. Each yielded chunk is one
   * of the kinds defined by `ModelStreamChunk`. The stream respects
   * the request's `abortSignal` between chunks.
   */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted before start' }
      return
    }
    const url = this.buildUrl('/v1/chat/completions')
    const stream = request.stream ?? !this.config.nonStreaming
    const body = this.buildRequestBody(request, stream)
    const headers = this.buildHeaders(stream)
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.abortSignal
    }
    let response: Response
    try {
      response = await this.fetchImpl(url, init)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { kind: 'error', message: `model request failed: ${message}` }
      return
    }
    if (!response.ok) {
      const text = await response.text()
      const classified = await this.classifyHttpError(response.status, text)
      yield {
        kind: 'error',
        message: classified.message,
        code: classified.code
      }
      return
    }
    if (this.config.nonStreaming || response.headers.get('content-type')?.includes('application/json')) {
      const json = (await response.json()) as ChatCompletionResponse
      yield* this.materializeNonStreaming(json)
      return
    }
    if (!response.body) {
      yield { kind: 'error', message: 'model response had no body' }
      return
    }
    yield* this.streamSse(response.body, request.abortSignal)
  }

  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    return `${base}${path}`
  }

  private buildHeaders(stream: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json'
    }
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }
    return { ...headers, ...(this.config.headers ?? {}) }
  }

  private async classifyHttpError(status: number, text: string): Promise<{ message: string; code: string }> {
    const body = text.slice(0, 500)
    if (status === 429) {
      return {
        message: `model request was rate limited (HTTP 429): ${body}`,
        code: 'rate_limited'
      }
    }
    if (status >= 500 && isDeepSeekHost(this.config.baseUrl)) {
      const probe = await probeDeepSeekReachable({
        baseUrl: this.config.baseUrl,
        fetchImpl: this.fetchImpl
      })
      return {
        message: `model request failed with DeepSeek HTTP ${status}: ${body} ${probe.message}`,
        code: probe.reachable ? `deepseek_http_${status}` : 'deepseek_unreachable'
      }
    }
    return {
      message: `model request failed with status ${status}: ${body}`,
      code: `http_${status}`
    }
  }

  private buildRequestBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const requestModel = request.model?.trim()
    const model = requestModel || this.config.model
    const messages = this.collectMessages(request, model)
    const body: Record<string, unknown> = {
      model,
      stream,
      messages
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' }
    }
    const includeThinking = !isAzureOpenAiEndpoint(this.config.baseUrl)
    applyReasoningEffort(body, request.reasoningEffort, { includeThinking })
    if (
      includeThinking &&
      !Object.prototype.hasOwnProperty.call(body, 'thinking') &&
      isThinkingProducerModel(model)
    ) {
      body.thinking = { type: 'enabled' }
    }
    const tools = normalizeToolSpecs(request.tools)
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
    }
    return body
  }

  private collectMessages(request: ModelRequest, model: string): ChatMessage[] {
    const out: ChatMessage[] = []
    if (request.systemPrompt) {
      out.push({ role: 'system', content: request.systemPrompt })
    }
    if (request.modeInstruction) {
      out.push({ role: 'system', content: request.modeInstruction })
    }
    for (const instruction of request.contextInstructions ?? []) {
      if (instruction.trim()) out.push({ role: 'system', content: instruction })
    }
    const windowSize = this.config.historyLimit
    const history = windowSize
      ? limitHistoryPreservingCompaction(request.history, windowSize)
      : request.history
    const thinkingMode = requiresReasoningRoundTrip(request.reasoningEffort, model)
    out.push(...this.itemsToMessages(
      repairModelHistoryItems([...request.prefix, ...history]),
      thinkingMode
    ))
    if (request.attachments?.length) {
      attachImagesToLatestUserMessage(out, request.attachments)
    }
    if (request.attachmentTextFallbacks?.length) {
      attachTextFallbacksToLatestUserMessage(out, request.attachmentTextFallbacks)
    }
    return normalizeThinkingAssistantMessages(healToolMessagePairs(out), thinkingMode)
  }

  private itemsToMessages(items: TurnItem[], thinkingMode: boolean): ChatMessage[] {
    const out: ChatMessage[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (isBridgeItemBeforeToolCall(items, index)) {
        continue
      }
      if (thinkingMode && item?.kind === 'assistant_reasoning') {
        const next = items[index + 1]
        if (next?.kind === 'assistant_text' && next.turnId === item.turnId) {
          out.push({
            role: 'assistant',
            content: next.text,
            reasoning_content: reasoningContentOrSpace(item.text)
          })
          index += 1
        }
        continue
      }
      if (item?.kind === 'tool_call') {
        const block = this.toolCallBlockToMessages(items, index, thinkingMode)
        if (block) {
          out.push(...block.messages)
          index = block.nextIndex - 1
        }
        continue
      }
      if (item?.kind === 'tool_result') continue
      const message = this.itemToMessage(item, thinkingMode)
      if (message) out.push(message)
    }
    return out
  }

  private toolCallBlockToMessages(
    items: TurnItem[],
    startIndex: number,
    thinkingMode: boolean
  ): { messages: ChatMessage[]; nextIndex: number } | null {
    const calls: Extract<TurnItem, { kind: 'tool_call' }>[] = []
    let index = startIndex
    while (index < items.length && items[index]?.kind === 'tool_call') {
      calls.push(items[index] as Extract<TurnItem, { kind: 'tool_call' }>)
      index += 1
    }
    if (calls.length === 0) return null

    const turnId = calls[0]?.turnId ?? ''
    const expectedCallIds = new Set(calls.map((call) => call.callId))
    const seenResultIds = new Set<string>()
    const resultMessages: ChatMessage[] = []
    const assistantText: string[] = []
    const reasoningText: string[] = []
    let bridgeIndex = startIndex - 1
    while (bridgeIndex >= 0) {
      const item = items[bridgeIndex]
      if (!item || !isPreToolCallBridgeItem(item, turnId)) break
      if (item.kind === 'assistant_text' && item.text.trim()) {
        assistantText.unshift(item.text)
      } else if (item.kind === 'assistant_reasoning' && item.text.trim()) {
        reasoningText.unshift(item.text)
      }
      bridgeIndex -= 1
    }
    let sawResult = false
    while (index < items.length) {
      const item = items[index]
      if (!item) break
      if (item.kind === 'tool_result') {
        sawResult = true
        if (expectedCallIds.has(item.callId) && !seenResultIds.has(item.callId)) {
          seenResultIds.add(item.callId)
          resultMessages.push(this.toolResultToMessage(item))
        }
        index += 1
        continue
      }
      if (isToolResultBridgeItem(item, { turnId, sawResult })) {
        if (!sawResult) {
          if (item.kind === 'assistant_text' && item.text.trim()) {
            assistantText.push(item.text)
          } else if (item.kind === 'assistant_reasoning' && item.text.trim()) {
            reasoningText.push(item.text)
          }
        }
        index += 1
        continue
      }
      break
    }

    if (![...expectedCallIds].every((callId) => seenResultIds.has(callId))) {
      return null
    }
    return {
      messages: [
        {
          role: 'assistant',
          content: assistantText.length > 0 ? assistantText.join('\n') : '',
          ...(thinkingMode ? { reasoning_content: reasoningContentOrSpace(reasoningText.join('\n')) } : {}),
          tool_calls: calls.map((call) => this.toolCallToWire(call))
        },
        ...resultMessages
      ],
      nextIndex: index
    }
  }

  private toolCallToWire(item: Extract<TurnItem, { kind: 'tool_call' }>): NonNullable<ChatMessage['tool_calls']>[number] {
    return {
      id: item.callId,
      type: 'function',
      function: { name: item.toolName, arguments: JSON.stringify(item.arguments) }
    }
  }

  private toolResultToMessage(item: Extract<TurnItem, { kind: 'tool_result' }>): ChatMessage {
    return {
      role: 'tool',
      content: toolResultContent(item.output),
      tool_call_id: item.callId
    }
  }

  private itemToMessage(item: TurnItem, thinkingMode: boolean): ChatMessage | null {
    switch (item.kind) {
      case 'user_message':
        return { role: 'user', content: item.text }
      case 'assistant_text':
        return {
          role: 'assistant',
          content: item.text,
          ...(thinkingMode ? { reasoning_content: ' ' } : {})
        }
      case 'assistant_reasoning':
        return null
      case 'tool_call':
        return {
          role: 'assistant',
          content: '',
          ...(thinkingMode ? { reasoning_content: ' ' } : {}),
          tool_calls: [this.toolCallToWire(item)]
        }
      case 'tool_result':
        return this.toolResultToMessage(item)
      case 'compaction':
        return item.replacedTokens > 0
          ? { role: 'system', content: `Conversation summary from earlier turns:\n${item.summary}` }
          : null
      case 'review':
        return item.status === 'completed' && item.reviewText?.trim()
          ? { role: 'system', content: `Code review result from an earlier turn:\n${item.reviewText}` }
          : null
      case 'approval':
      case 'user_input':
      case 'error':
        return null
    }
  }

  private async *streamSse(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal
  ): AsyncIterable<ModelStreamChunk> {
    const decoder = new TextDecoder('utf-8')
    const reader = body.getReader()
    let buffer = ''
    const pendingArguments = new Map<string, PendingToolCall>()
    let usage: UsageSnapshot | null = null
    let textAccumulator = ''
    let reasoningAccumulator = ''
    let stopReason: ModelStopReason = 'stop'
    let finishReason: string | null = null
    const idleTimeoutMs = normalizeStreamIdleTimeoutMs(this.config.streamIdleTimeoutMs)
    try {
      while (!signal.aborted) {
        const read = await readStreamChunk(reader, signal, idleTimeoutMs)
        if (read.kind === 'timeout') {
          yield {
            kind: 'error',
            message: `model stream stalled for ${idleTimeoutMs}ms without data`,
            code: 'stream_idle_timeout'
          }
          return
        }
        if (read.kind === 'aborted') break
        if (read.kind === 'error') {
          yield { kind: 'error', message: read.message, code: 'stream_read_error' }
          return
        }
        const { value, done } = read
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const dataLines = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('')
          if (!dataLines) continue
          if (dataLines === '[DONE]') {
            finishReason = finishReason ?? 'stop'
            break
          }
          let payload: unknown
          try {
            payload = JSON.parse(dataLines)
          } catch {
            continue
          }
          const result = this.consumeStreamPayload(
            payload as Record<string, unknown>,
            pendingArguments,
            textAccumulator,
            reasoningAccumulator
          )
          textAccumulator = result.text
          reasoningAccumulator = result.reasoning
          if (result.usage) usage = result.usage
          if (result.finishReason) finishReason = result.finishReason
          for (const chunk of result.chunks) yield chunk
        }
        if (finishReason === 'stop' || finishReason === 'tool_calls' || finishReason === 'length') break
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // The stream may already be released; ignore.
      }
    }
    if (signal.aborted) {
      yield { kind: 'error', message: 'request was aborted' }
      return
    }
    if (usage) yield { kind: 'usage', usage }
    stopReason = ((): ModelStopReason => {
      switch (finishReason) {
        case 'tool_calls':
          return 'tool_calls'
        case 'length':
          return 'length'
        case 'error':
          return 'error'
        default:
          return 'stop'
      }
    })()
    yield { kind: 'completed', stopReason }
  }

  private consumeStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    textAccumulator: string,
    reasoningAccumulator: string
  ): {
    chunks: ModelStreamChunk[]
    text: string
    reasoning: string
    finishReason: string | null
    usage: UsageSnapshot | null
  } {
    const chunks: ModelStreamChunk[] = []
    let text = textAccumulator
    let reasoning = reasoningAccumulator
    let finishReason: string | null = null
    let usage: UsageSnapshot | null = null
    const choice = (payload.choices as Record<string, unknown>[] | undefined)?.[0]
    if (choice && typeof choice === 'object') {
      const delta = choice.delta as Record<string, unknown> | undefined
      if (delta && typeof delta === 'object') {
        const content = delta.content
        if (typeof content === 'string' && content.length > 0) {
          text += content
          chunks.push({ kind: 'assistant_text_delta', text: content })
        }
        const reasoningContent = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
          reasoning += reasoningContent
          chunks.push({ kind: 'assistant_reasoning_delta', text: reasoningContent })
        }
        const toolCalls = delta.tool_calls as
          | {
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }[]
          | undefined
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const id = resolveToolCallDeltaId(call, pendingArguments)
            const existing = pendingArguments.get(id) ?? { index: numericIndex(call.index), name: undefined, arguments: '' }
            const resolvedIndex = numericIndex(call.index)
            if (resolvedIndex !== undefined) existing.index = resolvedIndex
            if (call.function?.name) existing.name = call.function.name
            if (typeof call.function?.arguments === 'string') {
              existing.arguments += call.function.arguments
              chunks.push({
                kind: 'tool_call_delta',
                callId: id,
                toolName: existing.name,
                argumentsDelta: call.function.arguments
              })
            }
            pendingArguments.set(id, existing)
          }
        }
      }
      if (typeof choice.finish_reason === 'string') {
        finishReason = choice.finish_reason
      }
    }
    const usagePayload = payload.usage as Record<string, unknown> | undefined
    if (usagePayload) {
      usage = this.mapUsage(usagePayload)
    }
    if (finishReason === 'tool_calls' && pendingArguments.size > 0) {
      for (const [callId, value] of pendingArguments) {
        if (!value.name) continue
        const args = this.parseToolArguments(value.arguments)
        chunks.push({
          kind: 'tool_call_complete',
          callId,
          toolName: value.name,
          arguments: args
        })
      }
      pendingArguments.clear()
    }
    return { chunks, text, reasoning, finishReason, usage }
  }

  private *materializeNonStreaming(
    payload: ChatCompletionResponse
  ): Generator<ModelStreamChunk> {
    const choice = payload.choices?.[0]
    if (!choice) {
      yield { kind: 'error', message: 'model response contained no choices' }
      return
    }
    const text = typeof choice.message?.content === 'string' ? choice.message.content : ''
    const reasoning = reasoningFromMessage(choice.message)
    if (reasoning) {
      yield { kind: 'assistant_reasoning_delta', text: reasoning }
    }
    if (text) {
      yield { kind: 'assistant_text_delta', text }
    }
    if (Array.isArray(choice.message?.tool_calls)) {
      for (const call of choice.message.tool_calls) {
        const args = this.parseToolArguments(call.function?.arguments ?? '{}')
        yield {
          kind: 'tool_call_complete',
          callId: call.id,
          toolName: call.function.name,
          arguments: args
        }
      }
    }
    if (payload.usage) {
      yield { kind: 'usage', usage: this.mapUsage(payload.usage) }
    }
    let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
    if (choice.finish_reason === 'tool_calls') stopReason = 'tool_calls'
    else if (choice.finish_reason === 'length') stopReason = 'length'
    else if (choice.finish_reason === 'error') stopReason = 'error'
    yield { kind: 'completed', stopReason }
  }

  private mapUsage(usage: Record<string, unknown>): UsageSnapshot {
    const promptTokens = Number(usage.prompt_tokens ?? usage.prompt_eval_count ?? 0) || 0
    const completionTokens = Number(usage.completion_tokens ?? usage.eval_count ?? 0) || 0
    const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0
    const promptDetails = usage.prompt_tokens_details as
      | { cached_tokens?: number }
      | undefined
    const nativeHit = Number(usage.prompt_cache_hit_tokens ?? 0) || 0
    const nativeMiss = Number(usage.prompt_cache_miss_tokens ?? 0) || 0
    const hasNativeCache = nativeHit > 0 || nativeMiss > 0
    const cachedTokens = Number(promptDetails?.cached_tokens ?? 0) || 0
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0) || 0
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0) || 0
    const cacheHit = hasNativeCache ? nativeHit : (cachedTokens > 0 ? cachedTokens : cacheRead)
    const cacheMiss = hasNativeCache ? nativeMiss : Math.max(promptTokens - cacheHit, 0)
    const cacheTotal = cacheHit + cacheMiss
    const cacheHitRate = cacheTotal === 0 ? null : cacheHit / cacheTotal
    const estimatedCost = estimateDeepseekCost({
      model: this.config.model,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      outputTokens: completionTokens
    })
    const estimatedSavings = estimateDeepseekCacheSavings({
      model: this.config.model,
      cacheHitTokens: cacheHit
    })
    const reportedCostUsd = Number(usage.cost_usd ?? usage.costUsd)
    const reportedCostCny = Number(usage.cost_cny ?? usage.costCny)
    return {
      ...emptyUsageSnapshot(),
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: cacheHit || cachedTokens || cacheRead || 0,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      cacheHitRate,
      turns: 1,
      costUsd: Number.isFinite(reportedCostUsd) ? reportedCostUsd : estimatedCost?.costUsd,
      costCny: Number.isFinite(reportedCostCny) ? reportedCostCny : estimatedCost?.costCny,
      cacheSavingsUsd: estimatedSavings?.costUsd,
      cacheSavingsCny: estimatedSavings?.costCny
    }
  }

  private parseToolArguments(raw: string): Record<string, unknown> {
    return repairToolArguments(raw).arguments
  }
}

function normalizeToolSpecs(tools: ModelToolSpec[]): ModelToolSpec[] {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: canonicalizeSchema(tool.inputSchema)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function applyReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  options: { includeThinking?: boolean } = {}
): void {
  const normalized = effort?.trim().toLowerCase()
  if (!normalized) return
  const includeThinking = options.includeThinking !== false
  switch (normalized) {
    case 'off':
    case 'disabled':
    case 'none':
    case 'false':
      if (includeThinking) body.thinking = { type: 'disabled' }
      break
    case 'low':
    case 'minimal':
    case 'medium':
    case 'mid':
    case 'high':
      body.reasoning_effort = 'high'
      if (includeThinking) body.thinking = { type: 'enabled' }
      break
    case 'max':
    case 'maximum':
    case 'xhigh':
      body.reasoning_effort = 'max'
      if (includeThinking) body.thinking = { type: 'enabled' }
      break
  }
}

function isAzureOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')
  } catch {
    return /\.openai\.azure\.com\b|\.cognitiveservices\.azure\.com\b/i.test(baseUrl)
  }
}

function isThinkingMode(effort: string | undefined): boolean {
  const normalized = effort?.trim().toLowerCase()
  if (!normalized) return false
  return !['off', 'disabled', 'none', 'false'].includes(normalized)
}

function requiresReasoningRoundTrip(effort: string | undefined, model: string | undefined): boolean {
  return isThinkingMode(effort) || isThinkingProducerModel(model)
}

function isThinkingProducerModel(model: string | undefined): boolean {
  const normalized = normalizeModelId(model)
  if (!normalized) return false
  return normalized === 'deepseek-v4-pro' ||
    normalized === 'deepseek-v4-flash' ||
    normalized.includes('deepseek-reasoner') ||
    normalized.endsWith('/deepseek-v4-pro') ||
    normalized.endsWith('/deepseek-v4-flash')
}

function reasoningContentOrSpace(text: string): string {
  return text.trim() ? text : ' '
}

function toolResultContent(output: unknown): string {
  if (typeof output === 'string') return output
  return JSON.stringify(output) ?? ''
}

function reasoningFromMessage(message: ChatCompletionResponse['choices'][number]['message'] | undefined): string {
  if (!message) return ''
  const value = message.reasoning_content ??
    (message as ChatMessage & { reasoning?: unknown }).reasoning
  return typeof value === 'string' ? value : ''
}

function isPreToolCallBridgeItem(item: TurnItem, turnId: string): boolean {
  if (item.turnId !== turnId) return false
  return item.kind === 'assistant_reasoning' || item.kind === 'assistant_text'
}

function isBridgeItemBeforeToolCall(items: TurnItem[], index: number): boolean {
  const item = items[index]
  if (!item || (item.kind !== 'assistant_reasoning' && item.kind !== 'assistant_text')) {
    return false
  }
  let cursor = index + 1
  while (cursor < items.length) {
    const next = items[cursor]
    if (!next) return false
    if (next.kind === 'assistant_reasoning' || next.kind === 'assistant_text') {
      if (next.turnId !== item.turnId) return false
      cursor += 1
      continue
    }
    return next.kind === 'tool_call' && next.turnId === item.turnId
  }
  return false
}

function normalizeThinkingAssistantMessages(
  messages: ChatMessage[],
  thinkingMode: boolean
): ChatMessage[] {
  if (!thinkingMode) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    const next = { ...message }
    if (next.content == null) next.content = ''
    if (
      !Object.prototype.hasOwnProperty.call(next, 'reasoning_content') ||
      next.reasoning_content == null ||
      !next.reasoning_content.trim()
    ) {
      next.reasoning_content = ' '
    }
    return next
  })
}

function canonicalizeSchema(value: unknown): Record<string, unknown> {
  const canonical = canonicalize(value)
  return canonical && typeof canonical === 'object' && !Array.isArray(canonical)
    ? canonical as Record<string, unknown>
    : {}
}

function normalizeModelId(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}

function normalizeStreamIdleTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(value)) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  return Math.max(0, Math.floor(value))
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number
): Promise<StreamReadResult> {
  if (signal.aborted) return { kind: 'aborted' }
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cleanupAbort: (() => void) | undefined
  const readPromise = reader.read()
    .then((result): StreamReadResult => ({ kind: 'chunk', ...result }))
    .catch((error): StreamReadResult => {
      if (signal.aborted) return { kind: 'aborted' }
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', message: `model stream read failed: ${message}` }
    })
  const abortPromise = new Promise<StreamReadResult>((resolve) => {
    const onAbort = (): void => resolve({ kind: 'aborted' })
    if (signal.aborted) {
      resolve({ kind: 'aborted' })
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupAbort = () => signal.removeEventListener('abort', onAbort)
  })
  const candidates: Array<Promise<StreamReadResult>> = [readPromise, abortPromise]
  if (idleTimeoutMs > 0) {
    candidates.push(new Promise<StreamReadResult>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timeout' }), idleTimeoutMs)
    }))
  }
  const result = await Promise.race(candidates)
  if (timeout) clearTimeout(timeout)
  cleanupAbort?.()
  if (result.kind === 'timeout') {
    try {
      await reader.cancel('model stream idle timeout')
    } catch {
      // Best-effort cancellation; the caller will surface the timeout.
    }
  }
  return result
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return out
}

function resolveToolCallDeltaId(
  call: { index?: number; id?: string },
  pending: Map<string, PendingToolCall>
): string {
  const index = numericIndex(call.index)
  const existingByIndex = findPendingToolCallIdByIndex(pending, index)
  if (call.id) {
    if (existingByIndex && existingByIndex !== call.id) {
      const existing = pending.get(existingByIndex)
      if (existing) {
        pending.delete(existingByIndex)
        pending.set(call.id, existing)
      }
    }
    return call.id
  }
  return existingByIndex ?? `call_${pending.size + 1}`
}

function findPendingToolCallIdByIndex(
  pending: Map<string, PendingToolCall>,
  index: number | undefined
): string | undefined {
  if (index === undefined) return undefined
  for (const [callId, value] of pending) {
    if (value.index === index) return callId
  }
  return undefined
}

function numericIndex(index: unknown): number | undefined {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0
    ? index
    : undefined
}

function healToolMessagePairs(messages: ChatMessage[]): ChatMessage[] {
  const healed: ChatMessage[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (message.role === 'tool') {
      continue
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const expectedIds = new Set(message.tool_calls.map((call) => call.id))
      const toolResults: ChatMessage[] = []
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool') {
        const toolResult = messages[j]
        if (toolResult.tool_call_id && expectedIds.has(toolResult.tool_call_id)) {
          toolResults.push(toolResult)
        }
        j += 1
      }
      const seenIds = new Set(toolResults.map((toolResult) => toolResult.tool_call_id))
      if ([...expectedIds].every((id) => seenIds.has(id))) {
        healed.push(message, ...toolResults)
      }
      i = j - 1
      continue
    }
    healed.push(message)
  }
  return healed
}

function attachImagesToLatestUserMessage(
  messages: ChatMessage[],
  attachments: NonNullable<ModelRequest['attachments']>
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const parts: ChatMessageContentPart[] = []
    if (typeof message.content === 'string' && message.content) {
      parts.push({ type: 'text', text: message.content })
    }
    for (const attachment of attachments) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`
        }
      })
    }
    message.content = parts
    return
  }
}

function attachTextFallbacksToLatestUserMessage(
  messages: ChatMessage[],
  attachments: NonNullable<ModelRequest['attachmentTextFallbacks']>
): void {
  const text = attachments.map(formatAttachmentTextFallback).join('\n\n')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') {
      message.content = message.content ? `${message.content}\n\n${text}` : text
      return
    }
    if (Array.isArray(message.content)) {
      message.content.push({ type: 'text', text })
      return
    }
    message.content = text
    return
  }
}

function formatAttachmentTextFallback(
  attachment: NonNullable<ModelRequest['attachmentTextFallbacks']>[number]
): string {
  return [
    '[Attached image as base64 text]',
    `Name: ${attachment.name}`,
    `MIME: ${attachment.mimeType}`,
    `Dimensions: ${formatAttachmentDimensions(attachment)}`,
    `Bytes: ${attachment.byteSize}`,
    'Base64:',
    '```base64',
    attachment.dataBase64,
    '```',
    '[/Attached image]'
  ].join('\n')
}

function formatAttachmentDimensions(
  attachment: NonNullable<ModelRequest['attachmentTextFallbacks']>[number]
): string {
  return attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : 'unknown'
}

function limitHistoryPreservingCompaction(history: TurnItem[], windowSize: number): TurnItem[] {
  if (history.length <= windowSize) return history
  const windowStart = history.length - windowSize
  const limited = history.slice(windowStart)
  if (limited.some((item) => item.kind === 'compaction' && item.replacedTokens > 0)) {
    return limited
  }
  for (let index = windowStart - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind !== 'compaction' || item.replacedTokens === 0) continue
    return windowSize <= 1 ? [item] : [item, ...history.slice(-(windowSize - 1))]
  }
  return limited
}
