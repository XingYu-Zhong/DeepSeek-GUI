import { z } from 'zod'
import { ReviewOutputSchema, ReviewTargetSchema } from './review.js'

/**
 * Conversation items returned as part of a thread or turn.
 *
 * Items represent normalized content (text, reasoning, tool calls, tool
 * results, approvals, and errors). The renderer maps items into chat
 * blocks; the server only persists and replays them.
 */
export const TurnItemRole = z.enum(['user', 'assistant', 'system', 'tool'])
export type TurnItemRole = z.infer<typeof TurnItemRole>

export const TurnItemStatus = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'aborted'
])
export type TurnItemStatus = z.infer<typeof TurnItemStatus>

export const TurnItemBase = z.object({
  id: z.string().min(1),
  turnId: z.string().min(1),
  threadId: z.string().min(1),
  role: TurnItemRole,
  status: TurnItemStatus,
  createdAt: z.string(),
  finishedAt: z.string().optional()
})

const UserInputOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string()
})

const UserInputQuestionSchema = z.object({
  header: z.string().min(1),
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(UserInputOptionSchema)
})

export const UserTurnItem = TurnItemBase.extend({
  kind: z.literal('user_message'),
  text: z.string(),
  displayText: z.string().optional(),
  attachmentIds: z.array(z.string().min(1)).optional()
})
export type UserTurnItem = z.infer<typeof UserTurnItem>

export const AssistantTextTurnItem = TurnItemBase.extend({
  kind: z.literal('assistant_text'),
  text: z.string()
})
export type AssistantTextTurnItem = z.infer<typeof AssistantTextTurnItem>

export const AssistantReasoningTurnItem = TurnItemBase.extend({
  kind: z.literal('assistant_reasoning'),
  text: z.string()
})
export type AssistantReasoningTurnItem = z.infer<typeof AssistantReasoningTurnItem>

export const ToolCallTurnItem = TurnItemBase.extend({
  kind: z.literal('tool_call'),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  toolKind: z.enum(['tool_call', 'command_execution', 'file_change']),
  arguments: z.record(z.string(), z.unknown()),
  summary: z.string().optional()
})
export type ToolCallTurnItem = z.infer<typeof ToolCallTurnItem>

export const ToolResultTurnItem = TurnItemBase.extend({
  kind: z.literal('tool_result'),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  toolKind: z.enum(['tool_call', 'command_execution', 'file_change']),
  output: z.unknown(),
  isError: z.boolean().default(false)
})
export type ToolResultTurnItem = z.infer<typeof ToolResultTurnItem>

export const ApprovalTurnItem = TurnItemBase.extend({
  kind: z.literal('approval'),
  approvalId: z.string().min(1),
  toolName: z.string().min(1),
  summary: z.string(),
  status: z.enum(['pending', 'allowed', 'denied', 'expired'])
})
export type ApprovalTurnItem = z.infer<typeof ApprovalTurnItem>

export const UserInputTurnItem = TurnItemBase.extend({
  kind: z.literal('user_input'),
  inputId: z.string().min(1),
  prompt: z.string(),
  questions: z.array(UserInputQuestionSchema).default([]),
  status: z.enum(['pending', 'submitted', 'cancelled'])
})
export type UserInputTurnItem = z.infer<typeof UserInputTurnItem>

export const CompactionTurnItem = TurnItemBase.extend({
  kind: z.literal('compaction'),
  summary: z.string(),
  replacedTokens: z.number().int().nonnegative(),
  pinnedConstraints: z.array(z.string()),
  sourceDigest: z.string().min(1).optional(),
  digestMarker: z.string().min(1).optional(),
  sourceItemIds: z.array(z.string().min(1)).optional()
})
export type CompactionTurnItem = z.infer<typeof CompactionTurnItem>

export const ReviewTurnItem = TurnItemBase.extend({
  kind: z.literal('review'),
  target: ReviewTargetSchema,
  title: z.string().min(1),
  reviewText: z.string().optional(),
  output: ReviewOutputSchema.optional()
})
export type ReviewTurnItem = z.infer<typeof ReviewTurnItem>

export const ErrorTurnItem = TurnItemBase.extend({
  kind: z.literal('error'),
  message: z.string(),
  code: z.string().optional()
})
export type ErrorTurnItem = z.infer<typeof ErrorTurnItem>

export const TurnItem = z.discriminatedUnion('kind', [
  UserTurnItem,
  AssistantTextTurnItem,
  AssistantReasoningTurnItem,
  ToolCallTurnItem,
  ToolResultTurnItem,
  ApprovalTurnItem,
  UserInputTurnItem,
  CompactionTurnItem,
  ReviewTurnItem,
  ErrorTurnItem
])
export type TurnItem = z.infer<typeof TurnItem>

export type TurnItemKind = TurnItem['kind']
