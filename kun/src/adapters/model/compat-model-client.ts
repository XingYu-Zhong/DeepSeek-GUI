import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../ports/model-client.js'
import type { TurnItem } from '../../contracts/items.js'
import { emptyUsageSnapshot, type UsageSnapshot } from '../../contracts/usage.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { LlmDebugRound, LlmDebugSink } from '../../services/llm-debug-recorder.js'
import { estimateDeepseekCost } from './deepseek-pricing.js'
import { estimateMiniMaxCost } from './minimax-pricing.js'
import { isToolResultBridgeItem, repairModelHistoryItems } from '../../domain/model-history-repair.js'
import { repairToolArguments } from './tool-argument-repair.js'
import { isDeepSeekHost, probeDeepSeekReachable } from './model-error-probe.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  normalizeModelEndpointFormat,
  resolveModelEndpointFormat,
  usesChatCompletionsShape,
  type ModelEndpointFormat
} from '../../contracts/model-endpoint-format.js'

/**
 * Configuration for the compatible HTTP model client. Chat
 * completions remains the default, while custom providers can opt into
 * OpenAI Responses or Anthropic Messages request/response shapes.
 */
export type CompatModelClientConfig = {
  baseUrl: string
  apiKey: string
  model: string
  /** Compatible request/response protocol to use for custom providers. */
  endpointFormat?: ModelEndpointFormat
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
  /** Optional model capability resolver used for provider-specific reasoning translation. */
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  /** Optional troubleshooting sink that captures each request body + raw output. */
  debugSink?: LlmDebugSink
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

type AnthropicCacheControl = { type: 'ephemeral' }

type AnthropicContentBlock = (
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
) & { cache_control?: AnthropicCacheControl }

type AnthropicImageSource = Extract<AnthropicContentBlock, { type: 'image' }>['source']

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

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

type ResponsesApiResponse = {
  id?: string
  status?: string
  output_text?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, unknown>
  error?: { message?: string; type?: string } | null
  incomplete_details?: { reason?: string } | null
}

type AnthropicMessageResponse = {
  id?: string
  type?: string
  role?: string
  content?: Array<Record<string, unknown>>
  stop_reason?: string | null
  usage?: Record<string, unknown>
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
const DEFAULT_MESSAGES_MAX_TOKENS = 4096

/**
 * Multi-provider HTTP model client.
 *
 * Speaks the streaming chat completions shape by default, and can switch
 * to OpenAI Responses or Anthropic Messages request/response shapes per
 * provider via `endpointFormat`. It supports tool calls, cache hit/miss
 * counters (when the provider reports them), and abort-signal
 * cancellation. The client is deliberately small so the rest of the
 * runtime can be built around the `ModelClient` port.
 */
export class CompatModelClient implements ModelClient {
  readonly provider = 'compat'
  readonly model: string

  private readonly config: CompatModelClientConfig
  private readonly fetchImpl: typeof fetch

  constructor(config: CompatModelClientConfig) {
    this.config = config
    this.model = config.model
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  /**
   * Streams the model response for a turn. Each yielded chunk is one
   * of the kinds defined by `ModelStreamChunk`. The stream respects
   * the request's `abortSignal` between chunks.
   */
  /**
   * Public entry point. When a `debugSink` is configured, captures the
   * literal request body and accumulates the raw output for the
   * troubleshooting view; otherwise forwards with zero overhead.
   */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const sink = this.config.debugSink
    if (!sink) {
      yield* this.streamInner(request, null)
      return
    }
    const round = sink.start({
      threadId: request.threadId,
      turnId: request.turnId,
      provider: this.provider,
      model: request.model?.trim() || this.config.model
    })
    try {
      for await (const chunk of this.streamInner(request, round)) {
        this.captureChunk(round, chunk)
        yield chunk
      }
    } finally {
      sink.finish(round)
    }
  }

  private captureChunk(round: LlmDebugRound, chunk: ModelStreamChunk): void {
    const out = round.output
    switch (chunk.kind) {
      case 'assistant_text_delta':
        out.text += chunk.text
        break
      case 'assistant_reasoning_delta':
        out.reasoning += chunk.text
        break
      case 'tool_call_complete':
        out.toolCalls.push({
          callId: chunk.callId,
          toolName: chunk.toolName,
          arguments: chunk.arguments
        })
        break
      case 'usage':
        out.usage = chunk.usage
        break
      case 'completed':
        out.stopReason = chunk.stopReason
        break
      case 'error':
        out.error = chunk.message
        break
    }
  }

  private async *streamInner(
    request: ModelRequest,
    round: LlmDebugRound | null
  ): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted before start' }
      return
    }
    const configuredEndpointFormat = this.endpointFormat()
    const endpointFormat = resolveModelEndpointFormat(configuredEndpointFormat, this.config.baseUrl)
    if (!endpointFormat) {
      yield {
        kind: 'error',
        message: 'custom full endpoint URL must end with /chat/completions, /completions, /responses, or /messages'
      }
      return
    }
    const url = buildModelEndpointUrl(this.config.baseUrl, configuredEndpointFormat)
    const stream = request.stream ?? !this.config.nonStreaming
    const requestModel = request.model?.trim() || this.config.model
    const body = this.buildRequestBody(request, stream, { endpointFormat })
    if (round) {
      round.requestBody = body
      round.url = redactUrlForLog(url)
    }
    const headers = this.buildHeaders(stream, endpointFormat)
    const result = await this.postChatCompletion(url, headers, body, request.abortSignal)
    if (result.kind === 'error') {
      yield { kind: 'error', message: result.message }
      return
    }
    let response = result.response
    if (!response.ok) {
      const text = await response.text()
      if (usesChatCompletionsShape(endpointFormat) && shouldRetryWithoutStreamUsage(response.status, text, body)) {
        const retryBody = this.buildRequestBody(request, stream, { endpointFormat, includeStreamUsage: false })
        if (round) round.requestBody = retryBody
        const retry = await this.postChatCompletion(url, headers, retryBody, request.abortSignal)
        if (retry.kind === 'error') {
          yield { kind: 'error', message: retry.message }
          return
        }
        response = retry.response
        if (response.ok) {
          if (this.config.nonStreaming || response.headers.get('content-type')?.includes('application/json')) {
            const json = (await response.json()) as ChatCompletionResponse
            yield* this.materializeNonStreaming(json, endpointFormat, requestModel)
            return
          }
          if (!response.body) {
            yield { kind: 'error', message: 'model response had no body' }
            return
          }
          yield* this.streamSse(response.body, request.abortSignal, endpointFormat, requestModel)
          return
        }
        const retryText = await response.text()
        this.logHttpFailure({
          url,
          status: response.status,
          body: retryText,
          endpointFormat,
          configuredEndpointFormat,
          model: requestModel
        })
        const retryClassified = await this.classifyHttpError(response.status, retryText)
        yield {
          kind: 'error',
          message: retryClassified.message,
          code: retryClassified.code
        }
        return
      }
      this.logHttpFailure({
        url,
        status: response.status,
        body: text,
        endpointFormat,
        configuredEndpointFormat,
        model: requestModel
      })
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
      yield* this.materializeNonStreaming(json, endpointFormat, requestModel)
      return
    }
    if (!response.body) {
      yield { kind: 'error', message: 'model response had no body' }
      return
    }
    yield* this.streamSse(response.body, request.abortSignal, endpointFormat, requestModel)
  }

  private endpointFormat(): ModelEndpointFormat {
    return normalizeModelEndpointFormat(this.config.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT)
  }

  private modelReasoningFor(model: string): ModelCapabilityMetadata['reasoning'] | undefined {
    return this.config.modelCapabilities?.(model).reasoning
  }

  private async postChatCompletion(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ kind: 'response'; response: Response } | { kind: 'error'; message: string }> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      })
      return { kind: 'response', response }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', message: `model request failed: ${message}` }
    }
  }

  private buildHeaders(stream: boolean, endpointFormat: ModelEndpointFormat): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    // `stream: true` is enough for OpenAI-compatible providers to return SSE.
    // Some Windows Node/Electron paths time out when routing requests with
    // `Accept: text/event-stream`, while the same stream works without it.
    if (!stream) headers.Accept = 'application/json'
    if (this.config.apiKey) {
      if (endpointFormat === 'messages') {
        headers.Authorization = `Bearer ${this.config.apiKey}`
        headers['x-api-key'] = this.config.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers.Authorization = `Bearer ${this.config.apiKey}`
      }
    }
    return { ...headers, ...(this.config.headers ?? {}) }
  }

  private async classifyHttpError(status: number, text: string): Promise<{ message: string; code: string }> {
    const body = text
    if (status === 404) {
      const prefix = body ? `${body} ` : ''
      return {
        message: `model request failed with status 404: ${prefix}Check your model provider configuration, especially Base URL and Endpoint format.`,
        code: 'http_404'
      }
    }
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

  private logHttpFailure(input: {
    url: string
    status: number
    body: string
    endpointFormat: ModelEndpointFormat
    configuredEndpointFormat: ModelEndpointFormat
    model: string
  }): void {
    console.warn('[kun:model] model HTTP request failed', {
      provider: this.provider,
      status: input.status,
      model: input.model,
      configuredModel: this.config.model,
      baseUrl: redactUrlForLog(this.config.baseUrl),
      requestUrl: redactUrlForLog(input.url),
      endpointFormat: input.endpointFormat,
      configuredEndpointFormat: input.configuredEndpointFormat,
      responseBody: summarizeForLog(input.body)
    })
  }

  private buildRequestBody(
    request: ModelRequest,
    stream: boolean,
    options: { endpointFormat?: ModelEndpointFormat; includeStreamUsage?: boolean } = {}
  ): Record<string, unknown> {
    const requestModel = request.model?.trim()
    const model = requestModel || this.config.model
    const messages = this.collectMessages(request, model)
    const endpointFormat = options.endpointFormat ?? this.endpointFormat()
    if (endpointFormat === 'responses') {
      return this.buildResponsesRequestBody(request, model, messages, stream)
    }
    if (endpointFormat === 'messages') {
      return this.buildAnthropicMessagesRequestBody(request, model, messages, stream)
    }
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
    if (stream && options.includeStreamUsage !== false) {
      body.stream_options = { include_usage: true }
    }
    const includeThinking = !isAzureOpenAiEndpoint(this.config.baseUrl)
    applyReasoningEffort(body, request.reasoningEffort, {
      includeThinking,
      reasoning: this.modelReasoningFor(model),
      maxReasoningEffort: isDeepSeekHost(this.config.baseUrl) ? 'max' : 'high'
    })
    if (
      includeThinking &&
      isDeepSeekHost(this.config.baseUrl) &&
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

  private buildResponsesRequestBody(
    request: ModelRequest,
    model: string,
    messages: ChatMessage[],
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      stream,
      input: messagesToResponsesInput(messages)
    }
    if (request.maxTokens !== undefined) {
      body.max_output_tokens = request.maxTokens
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.responseFormat === 'json_object') {
      body.text = { format: { type: 'json_object' } }
    }
    const reasoning = responsesReasoningForEffort(
      request.reasoningEffort,
      this.modelReasoningFor(model)
    )
    if (reasoning) body.reasoning = reasoning
    const tools = normalizeToolSpecs(request.tools)
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }))
    }
    return body
  }

  private buildAnthropicMessagesRequestBody(
    request: ModelRequest,
    model: string,
    messages: ChatMessage[],
    stream: boolean
  ): Record<string, unknown> {
    const converted = messagesToAnthropic(
      messages,
      this.modelReasoningFor(model)?.requestProtocol === 'anthropic-thinking'
    )
    applyAnthropicCacheControl(converted.messages)
    const body: Record<string, unknown> = {
      model,
      stream,
      max_tokens: request.maxTokens ?? DEFAULT_MESSAGES_MAX_TOKENS,
      messages: converted.messages
    }
    const systemText = request.responseFormat === 'json_object'
      ? [converted.system, 'Return a valid JSON object only.']
          .filter((item) => item.trim().length > 0)
          .join('\n\n')
      : converted.system
    if (systemText) {
      body.system = [
        { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }
      ] satisfies AnthropicContentBlock[]
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    applyAnthropicReasoningEffort(body, request.reasoningEffort, this.modelReasoningFor(model))
    const tools = normalizeToolSpecs(request.tools)
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
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
    const windowSize = this.config.historyLimit
    const history = windowSize
      ? limitHistoryPreservingCompaction(request.history, windowSize)
      : request.history
    const thinkingMode = requiresReasoningRoundTrip(
      request.reasoningEffort,
      model,
      this.config.baseUrl,
      this.modelReasoningFor(model)
    )
    out.push(...this.itemsToMessages(
      repairModelHistoryItems([...request.prefix, ...history]),
      thinkingMode
    ))
    // Per-turn context (goal budgets, todo state, memories, skill notes,
    // drift warnings) is volatile — the goal instruction alone embeds a
    // tokens-used counter that changes every step. It must trail the
    // stable history: placed before it, every counter tick invalidated
    // the provider prompt cache for the entire conversation.
    for (const instruction of request.contextInstructions ?? []) {
      if (instruction.trim()) out.push({ role: 'system', content: instruction })
    }
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
    signal: AbortSignal,
    endpointFormat: ModelEndpointFormat,
    model: string
  ): AsyncIterable<ModelStreamChunk> {
    const decoder = new TextDecoder('utf-8')
    const reader = body.getReader()
    let buffer = ''
    const pendingArguments = new Map<string, PendingToolCall>()
    const pendingByIndex = new Map<number, string>()
    const completedToolCalls = new Set<string>()
    let usage: UsageSnapshot | null = null
    let textAccumulator = ''
    let reasoningAccumulator = ''
    let stopReason: ModelStopReason = 'stop'
    let finishReason: string | null = null
    let sawDone = false
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
            sawDone = true
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
            pendingByIndex,
            completedToolCalls,
            textAccumulator,
            reasoningAccumulator,
            endpointFormat,
            model
          )
          textAccumulator = result.text
          reasoningAccumulator = result.reasoning
          if (result.usage) usage = mergeUsageSnapshots(usage, result.usage)
          if (result.finishReason) finishReason = result.finishReason
          for (const chunk of result.chunks) yield chunk
        }
        if (sawDone) break
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
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    textAccumulator: string,
    reasoningAccumulator: string,
    endpointFormat: ModelEndpointFormat,
    model: string
  ): {
    chunks: ModelStreamChunk[]
    text: string
    reasoning: string
    finishReason: string | null
    usage: UsageSnapshot | null
  } {
    const payloadError = modelPayloadError(payload)
    if (payloadError) {
      return {
        chunks: [{
          kind: 'error',
          message: payloadError.message,
          ...(payloadError.code ? { code: payloadError.code } : {})
        }],
        text: textAccumulator,
        reasoning: reasoningAccumulator,
        finishReason: 'error',
        usage: null
      }
    }
    if (endpointFormat === 'responses') {
      return this.consumeResponsesStreamPayload(
        payload,
        pendingArguments,
        pendingByIndex,
        completedToolCalls,
        textAccumulator,
        reasoningAccumulator,
        model
      )
    }
    if (endpointFormat === 'messages') {
      return this.consumeAnthropicMessagesStreamPayload(
        payload,
        pendingArguments,
        pendingByIndex,
        completedToolCalls,
        textAccumulator,
        reasoningAccumulator,
        model
      )
    }
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
      usage = this.mapUsage(usagePayload, model)
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

  private consumeResponsesStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    textAccumulator: string,
    reasoningAccumulator: string,
    model: string
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
    const type = recordString(payload, 'type')

    const outputIndex = numericIndex(payload.output_index)
    const item = recordValue(payload, 'item') ?? recordValue(payload, 'output_item')
    if (item) {
      const itemType = recordString(item, 'type')
      if (itemType === 'function_call' || itemType === 'custom_tool_call') {
        const callId = recordString(item, 'call_id') || recordString(item, 'id') || indexFallbackCallId(outputIndex, pendingArguments)
        const existing = pendingArguments.get(callId) ?? { index: outputIndex, name: undefined, arguments: '' }
        if (outputIndex !== undefined) {
          existing.index = outputIndex
          pendingByIndex.set(outputIndex, callId)
        }
        const name = recordString(item, 'name')
        if (name) existing.name = name
        const initialArguments = recordString(item, 'arguments') || recordString(item, 'input')
        if (initialArguments && !existing.arguments) existing.arguments = initialArguments
        pendingArguments.set(callId, existing)
        if (type === 'response.output_item.done' && existing.name) {
          chunks.push({
            kind: 'tool_call_complete',
            callId,
            toolName: existing.name,
            arguments: this.parseToolArguments(existing.arguments || '{}')
          })
          completedToolCalls.add(callId)
          pendingArguments.delete(callId)
        }
      }
    }

    if (type === 'response.output_text.delta') {
      const delta = recordString(payload, 'delta')
      if (delta) {
        text += delta
        chunks.push({ kind: 'assistant_text_delta', text: delta })
      }
    } else if (
      type === 'response.reasoning_text.delta' ||
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning.delta'
    ) {
      const delta = recordString(payload, 'delta')
      if (delta) {
        reasoning += delta
        chunks.push({ kind: 'assistant_reasoning_delta', text: delta })
      }
    } else if (type === 'response.function_call_arguments.delta') {
      const callId = responseStreamCallId(payload, pendingArguments, pendingByIndex)
      const existing = pendingArguments.get(callId) ?? { index: outputIndex, name: undefined, arguments: '' }
      const delta = recordString(payload, 'delta')
      if (outputIndex !== undefined) {
        existing.index = outputIndex
        pendingByIndex.set(outputIndex, callId)
      }
      if (delta) {
        existing.arguments += delta
        chunks.push({
          kind: 'tool_call_delta',
          callId,
          toolName: existing.name,
          argumentsDelta: delta
        })
      }
      pendingArguments.set(callId, existing)
    } else if (type === 'response.function_call_arguments.done') {
      const callId = responseStreamCallId(payload, pendingArguments, pendingByIndex)
      const existing = pendingArguments.get(callId) ?? { index: outputIndex, name: undefined, arguments: '' }
      const args = recordString(payload, 'arguments')
      if (args) existing.arguments = args
      if (existing.name) {
        pendingArguments.set(callId, existing)
      } else {
        pendingArguments.set(callId, existing)
      }
    } else if (type === 'response.completed') {
      const response = recordValue(payload, 'response') as ResponsesApiResponse | null
      const materialized = this.materializeResponsesOutput(response ?? (payload as ResponsesApiResponse), {
        skipText: Boolean(text),
        pendingArguments,
        completedToolCalls
      }, model)
      chunks.push(...materialized.chunks)
      if (materialized.usage) usage = materialized.usage
      finishReason = materialized.finishReason
    } else if (type === 'response.failed' || type === 'error') {
      const message = responseErrorMessage(payload)
      chunks.push({ kind: 'error', message, code: 'response_stream_error' })
      finishReason = 'error'
    }
    return { chunks, text, reasoning, finishReason, usage }
  }

  private consumeAnthropicMessagesStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    textAccumulator: string,
    reasoningAccumulator: string,
    model: string
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
    const type = recordString(payload, 'type')
    const index = numericIndex(payload.index)

    if (type === 'message_start') {
      const message = recordValue(payload, 'message')
      const usagePayload = message ? recordValue(message, 'usage') : null
      if (usagePayload) usage = this.mapUsage(usagePayload, model)
    } else if (type === 'content_block_start') {
      const block = recordValue(payload, 'content_block')
      if (block && recordString(block, 'type') === 'tool_use') {
        const callId = recordString(block, 'id') || indexFallbackCallId(index, pendingArguments)
        const existing = pendingArguments.get(callId) ?? { index, name: undefined, arguments: '' }
        if (index !== undefined) {
          existing.index = index
          pendingByIndex.set(index, callId)
        }
        const name = recordString(block, 'name')
        if (name) existing.name = name
        const input = recordValue(block, 'input')
        if (input && Object.keys(input).length > 0) existing.arguments = JSON.stringify(input)
        pendingArguments.set(callId, existing)
      }
    } else if (type === 'content_block_delta') {
      const delta = recordValue(payload, 'delta')
      const deltaType = delta ? recordString(delta, 'type') : ''
      if (deltaType === 'text_delta') {
        const value = recordString(delta, 'text')
        if (value) {
          text += value
          chunks.push({ kind: 'assistant_text_delta', text: value })
        }
      } else if (deltaType === 'thinking_delta') {
        const value = recordString(delta, 'thinking')
        if (value) {
          reasoning += value
          chunks.push({ kind: 'assistant_reasoning_delta', text: value })
        }
      } else if (deltaType === 'input_json_delta') {
        const callId = anthropicStreamCallId(index, pendingArguments, pendingByIndex)
        const existing = pendingArguments.get(callId) ?? { index, name: undefined, arguments: '' }
        const value = recordString(delta, 'partial_json')
        if (index !== undefined) {
          existing.index = index
          pendingByIndex.set(index, callId)
        }
        if (value) {
          existing.arguments += value
          chunks.push({
            kind: 'tool_call_delta',
            callId,
            toolName: existing.name,
            argumentsDelta: value
          })
        }
        pendingArguments.set(callId, existing)
      }
    } else if (type === 'content_block_stop') {
      const callId = index === undefined ? undefined : pendingByIndex.get(index)
      const pending = callId ? pendingArguments.get(callId) : undefined
      if (callId && pending?.name) {
        chunks.push({
          kind: 'tool_call_complete',
          callId,
          toolName: pending.name,
          arguments: this.parseToolArguments(pending.arguments || '{}')
        })
        completedToolCalls.add(callId)
        pendingArguments.delete(callId)
        if (index !== undefined) pendingByIndex.delete(index)
      }
    } else if (type === 'message_delta') {
      const delta = recordValue(payload, 'delta')
      const stopReason = delta ? recordString(delta, 'stop_reason') : ''
      const mappedStopReason = anthropicStopReason(stopReason)
      if (mappedStopReason) finishReason = mappedStopReason
      const usagePayload = recordValue(payload, 'usage')
      if (usagePayload) usage = this.mapUsage(usagePayload, model)
    } else if (type === 'message_stop') {
      finishReason = finishReason ?? 'stop'
    } else if (type === 'error') {
      chunks.push({ kind: 'error', message: responseErrorMessage(payload), code: 'messages_stream_error' })
      finishReason = 'error'
    }
    return { chunks, text, reasoning, finishReason, usage }
  }

  private *materializeNonStreaming(
    payload: ChatCompletionResponse,
    endpointFormat: ModelEndpointFormat,
    model: string
  ): Generator<ModelStreamChunk> {
    const payloadError = modelPayloadError(payload as unknown as Record<string, unknown>)
    if (payloadError) {
      yield {
        kind: 'error',
        message: payloadError.message,
        ...(payloadError.code ? { code: payloadError.code } : {})
      }
      return
    }
    if (endpointFormat === 'responses') {
      yield* this.materializeResponsesNonStreaming(payload as unknown as ResponsesApiResponse, model)
      return
    }
    if (endpointFormat === 'messages') {
      yield* this.materializeAnthropicMessagesNonStreaming(payload as unknown as AnthropicMessageResponse, model)
      return
    }
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
      yield { kind: 'usage', usage: this.mapUsage(payload.usage, model) }
    }
    let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
    if (choice.finish_reason === 'tool_calls') stopReason = 'tool_calls'
    else if (choice.finish_reason === 'length') stopReason = 'length'
    else if (choice.finish_reason === 'error') stopReason = 'error'
    yield { kind: 'completed', stopReason }
  }

  private *materializeResponsesNonStreaming(
    payload: ResponsesApiResponse,
    model: string
  ): Generator<ModelStreamChunk> {
    if (payload.error?.message) {
      yield { kind: 'error', message: payload.error.message, code: payload.error.type }
      return
    }
    const materialized = this.materializeResponsesOutput(payload, {}, model)
    yield* materialized.chunks
    if (materialized.usage) {
      yield { kind: 'usage', usage: materialized.usage }
    }
    yield { kind: 'completed', stopReason: materialized.finishReason }
  }

  private materializeResponsesOutput(
    payload: ResponsesApiResponse,
    options: {
      skipText?: boolean
      pendingArguments?: Map<string, PendingToolCall>
      completedToolCalls?: Set<string>
    } = {},
    model = this.config.model
  ): {
    chunks: ModelStreamChunk[]
    finishReason: ModelStopReason
    usage: UsageSnapshot | null
  } {
    const chunks: ModelStreamChunk[] = []
    let sawToolCall = (options.completedToolCalls?.size ?? 0) > 0
    if (!options.skipText) {
      const outputText = typeof payload.output_text === 'string'
        ? payload.output_text
        : responsesOutputText(payload.output)
      if (outputText) {
        chunks.push({ kind: 'assistant_text_delta', text: outputText })
      }
    }
    for (const item of payload.output ?? []) {
      const itemType = recordString(item, 'type')
      if (itemType !== 'function_call' && itemType !== 'custom_tool_call') continue
      const callId = recordString(item, 'call_id') || recordString(item, 'id')
      const toolName = recordString(item, 'name')
      if (!callId || !toolName) continue
      if (options.completedToolCalls?.has(callId)) continue
      sawToolCall = true
      const argsRaw = recordString(item, 'arguments') || recordString(item, 'input') || '{}'
      if (options.pendingArguments?.has(callId)) {
        options.pendingArguments.delete(callId)
      }
      chunks.push({
        kind: 'tool_call_complete',
        callId,
        toolName,
        arguments: this.parseToolArguments(argsRaw)
      })
    }
    const usage = payload.usage ? this.mapUsage(payload.usage, model) : null
    let finishReason: ModelStopReason = sawToolCall ? 'tool_calls' : 'stop'
    if (payload.status === 'incomplete') {
      finishReason = payload.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'error'
    } else if (payload.status === 'failed') {
      finishReason = 'error'
    }
    return { chunks, finishReason, usage }
  }

  private *materializeAnthropicMessagesNonStreaming(
    payload: AnthropicMessageResponse,
    model: string
  ): Generator<ModelStreamChunk> {
    let sawToolCall = false
    for (const block of payload.content ?? []) {
      const type = recordString(block, 'type')
      if (type === 'text') {
        const text = recordString(block, 'text')
        if (text) yield { kind: 'assistant_text_delta', text }
      } else if (type === 'thinking') {
        const thinking = recordString(block, 'thinking')
        if (thinking) yield { kind: 'assistant_reasoning_delta', text: thinking }
      } else if (type === 'tool_use') {
        const callId = recordString(block, 'id')
        const toolName = recordString(block, 'name')
        const input = recordValue(block, 'input') ?? {}
        if (callId && toolName) {
          sawToolCall = true
          yield {
            kind: 'tool_call_complete',
            callId,
            toolName,
            arguments: input
          }
        }
      }
    }
    if (payload.usage) {
      yield { kind: 'usage', usage: this.mapUsage(payload.usage, model) }
    }
    yield { kind: 'completed', stopReason: anthropicStopReason(payload.stop_reason) ?? (sawToolCall ? 'tool_calls' : 'stop') }
  }

  private mapUsage(usage: Record<string, unknown>, model = this.config.model): UsageSnapshot {
    const completionTokens = Number(usage.completion_tokens ?? usage.eval_count ?? usage.output_tokens ?? 0) || 0
    const promptDetails = usage.prompt_tokens_details as
      | { cached_tokens?: number }
      | undefined
    const nativeHit = Number(usage.prompt_cache_hit_tokens ?? 0) || 0
    const nativeMiss = Number(usage.prompt_cache_miss_tokens ?? 0) || 0
    const hasNativeCache = nativeHit > 0 || nativeMiss > 0
    const cachedTokens = Number(promptDetails?.cached_tokens ?? 0) || 0
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0) || 0
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0) || 0
    // Anthropic-protocol usage (MiniMax et al.) reports input_tokens
    // EXCLUDING cache reads/writes; OpenAI-style prompt_tokens includes
    // everything and marks the cached subset in prompt_tokens_details.
    const anthropicUsage = usage.prompt_tokens === undefined &&
      usage.prompt_eval_count === undefined &&
      usage.input_tokens !== undefined
    const reportedPromptTokens = Number(usage.prompt_tokens ?? usage.prompt_eval_count ?? usage.input_tokens ?? 0) || 0
    const promptTokens = anthropicUsage
      ? reportedPromptTokens + cacheRead + cacheCreation
      : reportedPromptTokens
    const cacheHit = hasNativeCache ? nativeHit : (cachedTokens > 0 ? cachedTokens : cacheRead)
    const cacheMiss = hasNativeCache ? nativeMiss : Math.max(promptTokens - cacheHit, 0)
    const cacheTotal = cacheHit + cacheMiss
    const cacheHitRate = cacheTotal === 0 ? null : cacheHit / cacheTotal
    const totalTokens = anthropicUsage
      ? promptTokens + completionTokens
      : Number(usage.total_tokens ?? promptTokens + completionTokens) || 0
    const pricingCacheRead = cacheRead || cacheHit
    const pricingCacheWrite = cacheCreation
    const pricingInputTokens = anthropicUsage
      ? reportedPromptTokens
      : Math.max(promptTokens - pricingCacheRead - pricingCacheWrite, 0)
    const estimatedCost = estimateDeepseekCost({
      model,
      providerHost: this.config.baseUrl,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      outputTokens: completionTokens
    }) ?? estimateMiniMaxCost({
      model,
      providerHost: this.config.baseUrl,
      inputTokens: pricingInputTokens,
      cacheReadTokens: pricingCacheRead,
      cacheWriteTokens: pricingCacheWrite,
      outputTokens: completionTokens
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
      costCny: Number.isFinite(reportedCostCny) ? reportedCostCny : estimatedCost?.costCny
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

function messagesToResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool') {
      if (message.tool_call_id) {
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: chatContentToPlainText(message.content)
        })
      }
      continue
    }
    const content = chatContentToResponsesContent(message.content)
    if (content !== undefined && !(Array.isArray(content) && content.length === 0)) {
      input.push({
        role: message.role,
        content
      })
    }
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: 'completed'
      })
    }
  }
  return input
}

function messagesToAnthropic(
  messages: ChatMessage[],
  includeThinkingBlocks = false
): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = []
  const out: AnthropicMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const text = chatContentToPlainText(message.content).trim()
      if (!text) continue
      // System messages that arrive after conversation turns are the
      // volatile per-turn context (goal budgets, memories, drift
      // warnings). Hoisting them into the top-level `system` block
      // would invalidate the provider's prompt cache for the whole
      // conversation on every counter tick, so they trail the history
      // inside a user turn instead — mirroring the chat_completions
      // ordering in collectMessages.
      if (out.length > 0) {
        appendTrailingInstruction(out, text)
        continue
      }
      system.push(text)
      continue
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id) continue
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: chatContentToPlainText(message.content)
        }]
      })
      continue
    }
    const content = chatContentToAnthropicContent(message.content)
    const blocks = Array.isArray(content)
      ? [...content]
      : content.trim()
        ? [{ type: 'text' as const, text: content }]
        : []
    if (includeThinkingBlocks && message.role === 'assistant') {
      const thinking = message.reasoning_content?.trim()
      if (thinking) blocks.unshift({ type: 'thinking', thinking })
    }
    for (const call of message.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: repairToolArguments(call.function.arguments).arguments
      })
    }
    if (blocks.length > 0) {
      out.push({ role: message.role, content: blocks })
      continue
    }
  }
  return { system: system.join('\n\n'), messages: out }
}

/**
 * Folds a trailing system instruction into the conversation as user
 * content. Appends to the final user message when one exists so the
 * request keeps strict user/assistant alternation.
 */
function appendTrailingInstruction(out: AnthropicMessage[], text: string): void {
  const block: AnthropicContentBlock = { type: 'text', text }
  const last = out[out.length - 1]
  if (last && last.role === 'user') {
    if (typeof last.content === 'string') {
      last.content = last.content.trim()
        ? [{ type: 'text', text: last.content }, block]
        : [block]
      return
    }
    last.content.push(block)
    return
  }
  out.push({ role: 'user', content: [block] })
}

/**
 * Marks the stable prefix for provider-side prompt caching. Anthropic
 * protocol caching is explicit: providers such as MiniMax only cache
 * content before `cache_control` breakpoints (up to 4 per request).
 * One breakpoint goes on the system block (which also covers the tool
 * definitions that precede it) and one on the final content block of
 * each of the last two messages, so consecutive agent steps re-hit the
 * prefix cached by the previous request.
 */
function applyAnthropicCacheControl(messages: AnthropicMessage[]): void {
  let breakpoints = 0
  for (let i = messages.length - 1; i >= 0 && breakpoints < 2; i -= 1) {
    const content = messages[i].content
    if (typeof content === 'string' || content.length === 0) continue
    content[content.length - 1].cache_control = { type: 'ephemeral' }
    breakpoints += 1
  }
}

function chatContentToResponsesContent(
  content: ChatMessage['content']
): string | Array<Record<string, unknown>> | undefined {
  if (content === null || content === undefined) return undefined
  if (typeof content === 'string') return content
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text })
    } else if (part.type === 'image_url') {
      parts.push({ type: 'input_image', image_url: part.image_url.url })
    }
  }
  return parts
}

function chatContentToAnthropicContent(content: ChatMessage['content']): string | AnthropicContentBlock[] {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  const parts: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: part.text })
      continue
    }
    const image = anthropicImageSource(part.image_url.url)
    if (image) parts.push({ type: 'image', source: image })
  }
  return parts
}

function anthropicImageSource(value: string): AnthropicImageSource | null {
  const data = parseDataUri(value)
  if (data) {
    return {
      type: 'base64',
      media_type: data.mimeType,
      data: data.base64
    }
  }
  if (/^https?:\/\//i.test(value)) {
    return { type: 'url', url: value }
  }
  return null
}

function parseDataUri(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function chatContentToPlainText(content: ChatMessage['content']): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return part.text
    return `[image: ${part.image_url.url}]`
  }).join('\n')
}

type ModelReasoningCapability = NonNullable<ModelCapabilityMetadata['reasoning']>
type NormalizedReasoningEffort = ModelReasoningCapability['defaultEffort']

function responsesReasoningForEffort(
  effort: string | undefined,
  reasoning?: ModelReasoningCapability
): Record<string, unknown> | null {
  if (reasoning && reasoning.requestProtocol !== 'openai-responses') return null
  const resolved = reasoning
    ? resolveReasoningEffort(effort, reasoning)
    : normalizeReasoningEffortValue(effort)
  if (resolved === 'auto' || resolved === 'off' || !resolved) return null
  const normalized = resolved
  switch (normalized) {
    case 'low':
      return { effort: 'low' }
    case 'medium':
      return { effort: 'medium' }
    case 'high':
    case 'max':
      return { effort: 'high' }
    default:
      return null
  }
}

function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCustomModelEndpointFormat(endpointFormat)) return exactModelEndpointUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  const lastSegment = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (lastSegment === 'beta') {
    return `${normalized.slice(0, -'/beta'.length)}/v1/${path}`
  }
  if (/^v\d+$/.test(lastSegment)) {
    return `${normalized}/${path}`
  }
  return `${normalized}/v1/${path}`
}

function exactModelEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const query = trimmed.search(/[?#]/)
  if (query < 0) return trimmed.replace(/\/+$/, '')
  return `${trimmed.slice(0, query).replace(/\/+$/, '')}${trimmed.slice(query)}`
}

function redactUrlForLog(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(key|token|secret|signature|auth|password)/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]')
      }
    }
    return parsed.toString()
  } catch {
    return trimmed.replace(/([?&][^=&]*(?:key|token|secret|signature|auth|password)[^=]*=)[^&#]*/gi, '$1[redacted]')
  }
}

function summarizeForLog(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 1_000 ? `${normalized.slice(0, 1_000)}...` : normalized
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return buildModelEndpointUrl(baseUrl, 'chat_completions')
}

function responsesOutputText(output: ResponsesApiResponse['output']): string {
  const parts: string[] = []
  for (const item of output ?? []) {
    if (recordString(item, 'type') !== 'message') continue
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      const type = recordString(record, 'type')
      if (type === 'output_text' || type === 'text') {
        const text = recordString(record, 'text')
        if (text) parts.push(text)
      }
    }
  }
  return parts.join('')
}

function responseStreamCallId(
  payload: Record<string, unknown>,
  pendingArguments: Map<string, PendingToolCall>,
  pendingByIndex: Map<number, string>
): string {
  const explicit = recordString(payload, 'call_id')
  if (explicit) return explicit
  const itemId = recordString(payload, 'item_id')
  if (itemId && pendingArguments.has(itemId)) return itemId
  const index = numericIndex(payload.output_index)
  if (index !== undefined) {
    return pendingByIndex.get(index) ?? indexFallbackCallId(index, pendingArguments)
  }
  if (pendingArguments.size === 1) return [...pendingArguments.keys()][0]
  return indexFallbackCallId(undefined, pendingArguments)
}

function anthropicStreamCallId(
  index: number | undefined,
  pendingArguments: Map<string, PendingToolCall>,
  pendingByIndex: Map<number, string>
): string {
  if (index !== undefined) {
    return pendingByIndex.get(index) ?? indexFallbackCallId(index, pendingArguments)
  }
  if (pendingArguments.size === 1) return [...pendingArguments.keys()][0]
  return indexFallbackCallId(undefined, pendingArguments)
}

function indexFallbackCallId(index: number | undefined, pendingArguments: Map<string, PendingToolCall>): string {
  return index === undefined ? `call_${pendingArguments.size + 1}` : `call_${index + 1}`
}

function responseErrorMessage(payload: Record<string, unknown>): string {
  const error = recordValue(payload, 'error') ?? recordValue(recordValue(payload, 'response'), 'error')
  const message = error ? recordString(error, 'message') : ''
  return message || recordString(payload, 'message') || 'model stream reported an error'
}

function modelPayloadError(payload: Record<string, unknown>): { message: string; code?: string } | null {
  const rawError = payload.error
  if (typeof rawError === 'string' && rawError.trim()) {
    return { message: rawError.trim() }
  }
  const directError = modelErrorObject(recordValue(payload, 'error'))
  if (directError) return directError
  const responseError = modelErrorObject(recordValue(recordValue(payload, 'response'), 'error'))
  if (responseError) return responseError
  const baseResp = recordValue(payload, 'base_resp') ?? recordValue(payload, 'baseResp')
  if (baseResp) {
    const code = errorCodeString(
      baseResp.status_code ?? baseResp.status ?? baseResp.code ?? baseResp.err_code
    )
    if (code && !successErrorCode(code)) {
      return {
        message:
          recordString(baseResp, 'status_msg') ||
          recordString(baseResp, 'message') ||
          recordString(baseResp, 'msg') ||
          `model provider error (${code})`,
        code
      }
    }
  }
  const topLevelCode = errorCodeString(payload.code ?? payload.type ?? payload.status_code ?? payload.err_code)
  const topLevelMessage =
    recordString(payload, 'message') ||
    recordString(payload, 'error_msg') ||
    recordString(payload, 'status_msg')
  if (topLevelCode && topLevelMessage && !successErrorCode(topLevelCode)) {
    return { message: topLevelMessage, code: topLevelCode }
  }
  return null
}

function modelErrorObject(error: Record<string, unknown> | null): { message: string; code?: string } | null {
  if (!error) return null
  const message =
    recordString(error, 'message') ||
    recordString(error, 'msg') ||
    recordString(error, 'status_msg') ||
    recordString(error, 'error_msg')
  const code = errorCodeString(error.code ?? error.type ?? error.status ?? error.status_code ?? error.err_code)
  if (message) return { message, ...(code ? { code } : {}) }
  if (code && !successErrorCode(code)) return { message: `model provider error (${code})`, code }
  return null
}

function errorCodeString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function successErrorCode(code: string): boolean {
  const normalized = code.trim().toLowerCase()
  return normalized === '0' || normalized === 'ok' || normalized === 'success'
}

function anthropicStopReason(value: unknown): ModelStopReason | undefined {
  if (typeof value !== 'string') return undefined
  switch (value) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    default:
      return undefined
  }
}

function recordValue(value: unknown, key?: string): Record<string, unknown> | null {
  const target = key === undefined
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : null
  return target && typeof target === 'object' && !Array.isArray(target)
    ? target as Record<string, unknown>
    : null
}

function recordString(value: unknown, key: string): string {
  const target = value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined
  return typeof target === 'string' ? target : ''
}

function mergeUsageSnapshots(current: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  if (!current) return next
  const promptTokens = next.promptTokens || current.promptTokens
  const completionTokens = Math.max(next.completionTokens, current.completionTokens)
  const totalTokens = next.totalTokens > 0 && next.promptTokens > 0
    ? next.totalTokens
    : promptTokens + completionTokens
  return {
    ...current,
    ...next,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens: Math.max(current.cachedTokens ?? 0, next.cachedTokens ?? 0),
    cacheHitTokens: Math.max(current.cacheHitTokens ?? 0, next.cacheHitTokens ?? 0),
    cacheMissTokens: Math.max(current.cacheMissTokens ?? 0, next.cacheMissTokens ?? 0),
    cacheHitRate: next.cacheHitRate ?? current.cacheHitRate,
    costUsd: next.costUsd ?? current.costUsd,
    costCny: next.costCny ?? current.costCny
  }
}

function applyReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  options: {
    includeThinking?: boolean
    reasoning?: ModelReasoningCapability
    maxReasoningEffort?: 'high' | 'max'
  } = {}
): void {
  const normalized = options.reasoning
    ? resolveReasoningEffort(effort, options.reasoning)
    : normalizeReasoningEffortValue(effort)
  if (!normalized) return
  const includeThinking = options.includeThinking !== false
  if (options.reasoning) {
    applyProfileReasoningEffort(body, normalized, options.reasoning, includeThinking)
    return
  }
  switch (normalized) {
    case 'off':
      if (includeThinking) body.thinking = { type: 'disabled' }
      break
    case 'low':
    case 'medium':
    case 'high':
      body.reasoning_effort = 'high'
      if (includeThinking) body.thinking = { type: 'enabled' }
      break
    case 'max':
      body.reasoning_effort = options.maxReasoningEffort ?? 'max'
      if (includeThinking) body.thinking = { type: 'enabled' }
      break
  }
}

function applyProfileReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  reasoning: ModelReasoningCapability,
  includeThinking: boolean
): void {
  switch (reasoning.requestProtocol) {
    case 'none':
    case 'openai-responses':
    case 'anthropic-thinking':
      return
    case 'deepseek-chat-completions':
      applyDeepSeekChatReasoningEffort(body, effort, includeThinking)
      return
    case 'glm-chat-completions':
      applyGlmChatReasoningEffort(body, effort, includeThinking)
      return
    case 'mimo-chat-completions':
      applyMimoChatReasoningEffort(body, effort, includeThinking)
      return
  }
}

function applyDeepSeekChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (effort === 'off') {
    if (includeThinking) body.thinking = { type: 'disabled' }
    return
  }
  if (effort === 'max') {
    body.reasoning_effort = 'max'
  } else if (effort !== 'auto') {
    body.reasoning_effort = 'high'
  }
  if (includeThinking && effort !== 'auto') body.thinking = { type: 'enabled' }
}

function applyGlmChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (!includeThinking || effort === 'auto') return
  body.thinking = {
    type: effort === 'off' ? 'disabled' : 'enabled',
    clear_thinking: true
  }
}

function applyMimoChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (effort === 'off') {
    if (includeThinking) body.thinking = { type: 'disabled' }
    return
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.reasoning_effort = effort
    if (includeThinking) body.thinking = { type: 'enabled' }
  }
}

function applyAnthropicReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  reasoning?: ModelReasoningCapability
): void {
  if (reasoning?.requestProtocol !== 'anthropic-thinking') return
  const resolved = resolveReasoningEffort(effort, reasoning)
  if (!resolved) return
  body.thinking = {
    type: resolved === 'off' ? 'disabled' : 'adaptive'
  }
}

function resolveReasoningEffort(
  effort: string | undefined,
  reasoning: ModelReasoningCapability
): NormalizedReasoningEffort | undefined {
  const normalized = normalizeReasoningEffortValue(effort)
  if (!normalized) return undefined
  if (reasoning.supportedEfforts.includes(normalized)) return normalized
  if (
    normalized === 'low' &&
    reasoning.supportedEfforts.includes('off') &&
    !reasoning.supportedEfforts.includes('low')
  ) {
    return 'off'
  }
  return reasoning.defaultEffort
}

function normalizeReasoningEffortValue(effort: string | undefined): NormalizedReasoningEffort | undefined {
  switch (effort?.trim().toLowerCase()) {
    case 'auto':
    case 'adaptive':
      return 'auto'
    case 'off':
    case 'disabled':
    case 'none':
    case 'false':
      return 'off'
    case 'low':
    case 'minimal':
      return 'low'
    case 'medium':
    case 'mid':
      return 'medium'
    case 'high':
      return 'high'
    case 'max':
    case 'maximum':
    case 'xhigh':
      return 'max'
    default:
      return undefined
  }
}

function shouldRetryWithoutStreamUsage(
  status: number,
  text: string,
  body: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 422) return false
  if (!Object.prototype.hasOwnProperty.call(body, 'stream_options')) return false
  return /\b(stream_options|include_usage)\b/i.test(text)
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

function requiresReasoningRoundTrip(
  effort: string | undefined,
  model: string | undefined,
  baseUrl: string,
  reasoning?: ModelReasoningCapability
): boolean {
  if (reasoning) {
    const resolved = resolveReasoningEffort(effort, reasoning)
    if (resolved) {
      return resolved !== 'off' && reasoning.requestProtocol !== 'none'
    }
    return isDeepSeekHost(baseUrl) && isThinkingProducerModel(model)
  }
  // Thinking-mode round trip is a DeepSeek-specific protocol extension.
  // OpenAI-compat providers (OpenRouter, llama.cpp, etc.) may reject
  // or misinterpret the `thinking` field, so we only auto-enable it
  // on the official DeepSeek host. User-selected reasoningEffort still
  // forces the path (opt-in). See issue #26.
  return isThinkingMode(effort) || (isDeepSeekHost(baseUrl) && isThinkingProducerModel(model))
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
  if (attachment.mimeType === 'text/plain') {
    return Buffer.from(attachment.dataBase64, 'base64').toString('utf8')
  }
  return [
    '[Attached image as base64 text]',
    `Name: ${attachment.name}`,
    `FilePath: ${attachment.localFilePath ?? 'unknown'}`,
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
