import type { TurnItem } from '../contracts/items.js'
import type { ReviewOutput, ReviewTarget } from '../contracts/review.js'

export type ItemEntity = TurnItem

export function makeUserItem(input: {
  id: string
  turnId: string
  threadId: string
  text: string
  displayText?: string
  attachmentIds?: string[]
}): TurnItem {
  const attachmentIds = input.attachmentIds?.filter((id) => id.trim().length > 0)
  const displayText = input.displayText?.trim()
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'user',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'user_message',
    text: input.text,
    ...(displayText && displayText !== input.text ? { displayText } : {}),
    ...(attachmentIds?.length ? { attachmentIds } : {})
  }
}

export function makeAssistantTextItem(input: {
  id: string
  turnId: string
  threadId: string
  text: string
  status?: 'running' | 'completed' | 'failed'
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'assistant',
    status: input.status ?? 'running',
    createdAt: new Date().toISOString(),
    kind: 'assistant_text',
    text: input.text
  }
}

export function makeAssistantReasoningItem(input: {
  id: string
  turnId: string
  threadId: string
  text: string
  status?: 'running' | 'completed' | 'failed'
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'assistant',
    status: input.status ?? 'running',
    createdAt: new Date().toISOString(),
    kind: 'assistant_reasoning',
    text: input.text
  }
}

export function makeToolCallItem(input: {
  id: string
  turnId: string
  threadId: string
  callId: string
  toolName: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments: Record<string, unknown>
  summary?: string
  status?: 'pending' | 'running' | 'completed' | 'failed'
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    status: input.status ?? 'pending',
    createdAt: new Date().toISOString(),
    kind: 'tool_call',
    toolName: input.toolName,
    callId: input.callId,
    toolKind: input.toolKind ?? 'tool_call',
    arguments: input.arguments,
    summary: input.summary
  }
}

export function makeToolResultItem(input: {
  id: string
  turnId: string
  threadId: string
  callId: string
  toolName: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  output: unknown
  isError?: boolean
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted'
  finishedAt?: string
}): TurnItem {
  const status = input.status ?? 'completed'
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    status,
    createdAt: new Date().toISOString(),
    ...(input.finishedAt
      ? { finishedAt: input.finishedAt }
      : status === 'completed' || status === 'failed' || status === 'aborted'
        ? { finishedAt: new Date().toISOString() }
        : {}),
    kind: 'tool_result',
    toolName: input.toolName,
    callId: input.callId,
    toolKind: input.toolKind ?? 'tool_call',
    output: input.output,
    isError: input.isError ?? false
  }
}

export function makeApprovalItem(input: {
  id: string
  turnId: string
  threadId: string
  approvalId: string
  toolName: string
  summary: string
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    createdAt: new Date().toISOString(),
    kind: 'approval',
    approvalId: input.approvalId,
    toolName: input.toolName,
    summary: input.summary,
    status: 'pending'
  }
}

export function makeUserInputItem(input: {
  id: string
  turnId: string
  threadId: string
  inputId: string
  prompt: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    createdAt: new Date().toISOString(),
    kind: 'user_input',
    inputId: input.inputId,
    prompt: input.prompt,
    questions: input.questions ?? [],
    status: 'pending'
  }
}

export function makeCompactionItem(input: {
  id: string
  turnId: string
  threadId: string
  summary: string
  replacedTokens: number
  pinnedConstraints: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'compaction',
    summary: input.summary,
    replacedTokens: input.replacedTokens,
    pinnedConstraints: input.pinnedConstraints,
    ...(input.sourceDigest ? { sourceDigest: input.sourceDigest } : {}),
    ...(input.digestMarker ? { digestMarker: input.digestMarker } : {}),
    ...(input.sourceItemIds ? { sourceItemIds: [...input.sourceItemIds] } : {})
  }
}

export function makeReviewItem(input: {
  id: string
  turnId: string
  threadId: string
  target: ReviewTarget
  title: string
  status?: 'running' | 'completed' | 'failed' | 'aborted'
  reviewText?: string
  output?: ReviewOutput
  finishedAt?: string
}): TurnItem {
  const status = input.status ?? 'running'
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'assistant',
    status,
    createdAt: new Date().toISOString(),
    ...(input.finishedAt
      ? { finishedAt: input.finishedAt }
      : status === 'completed' || status === 'failed' || status === 'aborted'
        ? { finishedAt: new Date().toISOString() }
        : {}),
    kind: 'review',
    target: input.target,
    title: input.title,
    ...(input.reviewText ? { reviewText: input.reviewText } : {}),
    ...(input.output ? { output: input.output } : {})
  }
}

export function makeErrorItem(input: {
  id: string
  turnId: string
  threadId: string
  message: string
  code?: string
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'failed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'error',
    message: input.message,
    code: input.code
  }
}
