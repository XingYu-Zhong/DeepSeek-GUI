import { z } from 'zod'
import { TurnSchema } from './turns.js'
import { ApprovalPolicySchema, DEFAULT_APPROVAL_POLICY, SandboxModeSchema } from './policy.js'

export const ThreadStatus = z.enum(['idle', 'running', 'archived', 'deleted'])
export type ThreadStatus = z.infer<typeof ThreadStatus>

export const ThreadMode = z.enum(['agent', 'plan'])
export type ThreadMode = z.infer<typeof ThreadMode>

/**
 * Discriminator describing how a thread relates to its origin.
 *
 * - `primary`: a top-level thread (the default).
 * - `fork`: a manual fork of another thread (switched-away clone).
 * - `side`: a "by-the-way" side conversation that inherits a one-time
 *   snapshot of its parent and runs in parallel. Excluded from the
 *   default thread listing.
 */
export const ThreadRelation = z.enum(['primary', 'fork', 'side'])
export type ThreadRelation = z.infer<typeof ThreadRelation>

export const ThreadGoalStatus = z.enum([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete'
])
export type ThreadGoalStatus = z.infer<typeof ThreadGoalStatus>

export const MAX_THREAD_GOAL_OBJECTIVE_CHARS = 4_000

export const ThreadGoalSchema = z.object({
  threadId: z.string().min(1),
  objective: z.string().trim().min(1).max(MAX_THREAD_GOAL_OBJECTIVE_CHARS),
  status: ThreadGoalStatus,
  tokenBudget: z.number().int().positive().nullable().optional(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ThreadGoal = z.infer<typeof ThreadGoalSchema>

export const ThreadTodoStatus = z.enum(['pending', 'in_progress', 'completed'])
export type ThreadTodoStatus = z.infer<typeof ThreadTodoStatus>

export const ThreadTodoSourceSchema = z.object({
  kind: z.literal('plan'),
  planId: z.string().min(1),
  relativePath: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  contentHash: z.string().min(1)
})
export type ThreadTodoSource = z.infer<typeof ThreadTodoSourceSchema>

export const MAX_THREAD_TODO_CONTENT_CHARS = 1_000
export const MAX_THREAD_TODOS = 200

export const ThreadTodoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1).max(MAX_THREAD_TODO_CONTENT_CHARS),
  status: ThreadTodoStatus,
  source: ThreadTodoSourceSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ThreadTodoItem = z.infer<typeof ThreadTodoItemSchema>

export const ThreadTodoListSchema = z.object({
  threadId: z.string().min(1),
  items: z.array(ThreadTodoItemSchema).max(MAX_THREAD_TODOS),
  updatedAt: z.string()
}).superRefine((value, ctx) => {
  const inProgressCount = value.items.filter((item) => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'at most one todo can be in_progress'
    })
  }
})
export type ThreadTodoList = z.infer<typeof ThreadTodoListSchema>

export const ThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  workspace: z.string(),
  model: z.string(),
  mode: ThreadMode,
  status: ThreadStatus,
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default('workspace-write'),
  costBudgetUsd: z.number().positive().optional(),
  costBudgetWarningSent: z.boolean().optional(),
  relation: ThreadRelation.default('primary'),
  parentThreadId: z.string().optional(),
  forkedFromThreadId: z.string().optional(),
  forkedFromTitle: z.string().optional(),
  forkedAt: z.string().optional(),
  forkedFromMessageCount: z.number().int().nonnegative().optional(),
  forkedFromTurnCount: z.number().int().nonnegative().optional(),
  goal: ThreadGoalSchema.optional(),
  todos: ThreadTodoListSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(TurnSchema).default([])
})
export type ThreadRecord = z.infer<typeof ThreadSchema>

export const ThreadSummarySchema = ThreadSchema.pick({
  id: true,
  title: true,
  workspace: true,
  model: true,
  mode: true,
  status: true,
  costBudgetUsd: true,
  costBudgetWarningSent: true,
  relation: true,
  parentThreadId: true,
  forkedFromThreadId: true,
  forkedFromTitle: true,
  forkedAt: true,
  forkedFromMessageCount: true,
  forkedFromTurnCount: true,
  goal: true,
  todos: true,
  createdAt: true,
  updatedAt: true
})
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>

export const CreateThreadRequest = z.object({
  title: z.string().optional(),
  workspace: z.string().min(1),
  model: z.string().min(1),
  mode: ThreadMode.default('agent'),
  approvalPolicy: ApprovalPolicySchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  costBudgetUsd: z.number().positive().optional()
})
export type CreateThreadRequest = z.infer<typeof CreateThreadRequest>

/**
 * Optional body for `POST /v1/threads/{id}/fork`.
 *
 * `relation` defaults to `'fork'` to preserve the existing manual-fork
 * behavior when the body is absent. Passing `relation: 'side'` marks
 * the new thread as a side conversation (e.g. spawned by `/btw`).
 */
export const ForkThreadRequest = z
  .object({
    relation: ThreadRelation.default('fork'),
    title: z.string().optional()
  })
  .optional()
export type ForkThreadRequest = z.infer<typeof ForkThreadRequest>

export const SetThreadGoalRequest = z
  .object({
    objective: z.string().trim().min(1).max(MAX_THREAD_GOAL_OBJECTIVE_CHARS).optional(),
    status: ThreadGoalStatus.optional(),
    tokenBudget: z.number().int().positive().nullable().optional()
  })
  .refine(
    (value) =>
      value.objective !== undefined ||
      value.status !== undefined ||
      value.tokenBudget !== undefined,
    { message: 'goal request must change at least one field' }
  )
export type SetThreadGoalRequest = z.infer<typeof SetThreadGoalRequest>

export const ThreadGoalResponse = z.object({
  goal: ThreadGoalSchema.nullable()
})
export type ThreadGoalResponse = z.infer<typeof ThreadGoalResponse>

export const ClearThreadGoalResponse = z.object({
  cleared: z.boolean()
})
export type ClearThreadGoalResponse = z.infer<typeof ClearThreadGoalResponse>

export const SetThreadTodosRequest = z.object({
  todos: z.array(
    z.object({
      id: z.string().min(1).optional(),
      content: z.string().trim().min(1).max(MAX_THREAD_TODO_CONTENT_CHARS),
      status: ThreadTodoStatus,
      source: ThreadTodoSourceSchema.optional()
    })
  ).max(MAX_THREAD_TODOS)
}).superRefine((value, ctx) => {
  const inProgressCount = value.todos.filter((item) => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['todos'],
      message: 'at most one todo can be in_progress'
    })
  }
})
export type SetThreadTodosRequest = z.infer<typeof SetThreadTodosRequest>

export const ThreadTodosResponse = z.object({
  todos: ThreadTodoListSchema.nullable()
})
export type ThreadTodosResponse = z.infer<typeof ThreadTodosResponse>

export const ClearThreadTodosResponse = z.object({
  cleared: z.boolean()
})
export type ClearThreadTodosResponse = z.infer<typeof ClearThreadTodosResponse>

export const UpdateThreadRequest = z
  .object({
    title: z.string().optional(),
    status: ThreadStatus.optional(),
    approvalPolicy: ApprovalPolicySchema.optional(),
    sandboxMode: SandboxModeSchema.optional(),
    costBudgetUsd: z.number().positive().nullable().optional(),
    costBudgetWarningSent: z.boolean().optional(),
    relation: ThreadRelation.optional()
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.status !== undefined ||
      value.approvalPolicy !== undefined ||
      value.sandboxMode !== undefined ||
      value.costBudgetUsd !== undefined ||
      value.costBudgetWarningSent !== undefined ||
      value.relation !== undefined,
    { message: 'update request must change at least one field' }
  )
export type UpdateThreadRequest = z.infer<typeof UpdateThreadRequest>

export const ListThreadsResponse = z.object({
  threads: z.array(ThreadSummarySchema)
})
export type ListThreadsResponse = z.infer<typeof ListThreadsResponse>

export const DeleteThreadResponse = z.object({
  id: z.string().min(1),
  deleted: z.literal(true)
})
export type DeleteThreadResponse = z.infer<typeof DeleteThreadResponse>
