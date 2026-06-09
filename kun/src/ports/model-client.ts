import type { TurnItem } from '../contracts/items.js'
import type { UsageSnapshot } from '../contracts/usage.js'

/**
 * One streaming chunk from a model response. The loop consumes these
 * chunks to drive assistant text and reasoning deltas, tool call
 * accumulation, and usage reporting.
 */
export type ModelStreamChunk =
  | { kind: 'assistant_text_delta'; text: string }
  | { kind: 'assistant_reasoning_delta'; text: string }
  | { kind: 'tool_call_delta'; callId: string; toolName?: string; argumentsDelta?: string }
  | { kind: 'tool_call_complete'; callId: string; toolName: string; arguments: Record<string, unknown> }
  | { kind: 'usage'; usage: UsageSnapshot }
  | { kind: 'completed'; stopReason: 'stop' | 'tool_calls' | 'length' | 'error' }
  | { kind: 'error'; message: string; code?: string }

/**
 * A single model turn request: the immutable prefix items, the running
 * conversation history, and any tools that are currently advertised.
 */
export type ModelRequest = {
  threadId: string
  turnId: string
  model: string
  systemPrompt?: string
  /**
   * Optional mode-scoped instruction (e.g. Plan mode guidance). Emitted
   * as a second system message immediately after the byte-stable
   * `systemPrompt` so the cached prefix stays unchanged while the mode
   * note still rides at the front of the request.
   */
  modeInstruction?: string
  /**
   * Dynamic per-turn system instructions, such as active Skill
   * guidance. These are intentionally outside the immutable prefix.
   */
  contextInstructions?: string[]
  prefix: TurnItem[]
  history: TurnItem[]
  attachments?: ModelInputAttachment[]
  attachmentTextFallbacks?: ModelTextAttachmentFallback[]
  tools: ModelToolSpec[]
  /**
   * Optional loop-level requirement. The agent loop uses this to keep
   * GUI-owned workflows, such as plan creation, tied to a concrete tool
   * result even when a provider ignores tool-use instructions.
   */
  requiredToolName?: string
  /** Optional per-request streaming override. Defaults to adapter configuration. */
  stream?: boolean
  /** Optional output cap forwarded to OpenAI-compatible providers. */
  maxTokens?: number
  /** Optional sampling controls for classifier-style calls. */
  temperature?: number
  topP?: number
  /** Optional structured response mode for short JSON classifier paths. */
  responseFormat?: 'json_object'
  /**
   * Optional DeepSeek-style thinking control. `off` disables thinking;
   * `high` and `max` enable it with a concrete reasoning effort.
   */
  reasoningEffort?: string
  abortSignal: AbortSignal
}

export type ModelInputAttachment = {
  id: string
  name: string
  mimeType: string
  dataBase64: string
  width?: number
  height?: number
}

export type ModelTextAttachmentFallback = {
  id: string
  name: string
  mimeType: string
  dataBase64: string
  byteSize: number
  width?: number
  height?: number
  wasCompressed?: boolean
}

export type ModelToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
}

/**
 * Port for talking to a model provider. Adapters implement this with
 * a DeepSeek-compatible HTTP client, with `pi-ai`, or with a test
 * double. The loop never depends on a concrete implementation.
 */
export interface ModelClient {
  readonly provider: string
  readonly model: string
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>
}
