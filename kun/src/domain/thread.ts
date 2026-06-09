import type {
  ThreadMode,
  ThreadRecord,
  ThreadGoal,
  ThreadTodoList,
  ThreadRelation,
  ThreadStatus
} from '../contracts/threads.js'
import { DEFAULT_APPROVAL_POLICY, type ApprovalPolicy, type SandboxMode } from '../contracts/policy.js'

/**
 * Domain helper for thread records. The contract type is the source of
 * truth; this module only adds small factory/utility helpers so the
 * services and stores can stay free of date-string formatting.
 */
export type ThreadEntity = ThreadRecord

export function createThreadRecord(input: {
  id: string
  title: string
  workspace: string
  model: string
  mode?: ThreadMode
  status?: ThreadStatus
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  costBudgetUsd?: number
  costBudgetWarningSent?: boolean
  relation?: ThreadRelation
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal
  todos?: ThreadTodoList
  createdAt?: string
}): ThreadEntity {
  const now = input.createdAt ?? new Date().toISOString()
  return {
    id: input.id,
    title: input.title,
    workspace: input.workspace,
    model: input.model,
    mode: input.mode ?? 'agent',
    status: input.status ?? 'idle',
    approvalPolicy: input.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
    sandboxMode: input.sandboxMode ?? 'workspace-write',
    ...(input.costBudgetUsd !== undefined ? { costBudgetUsd: input.costBudgetUsd } : {}),
    ...(input.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: input.costBudgetWarningSent } : {}),
    relation: input.relation ?? 'primary',
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    ...(input.forkedFromThreadId ? { forkedFromThreadId: input.forkedFromThreadId } : {}),
    ...(input.forkedFromTitle ? { forkedFromTitle: input.forkedFromTitle } : {}),
    ...(input.forkedAt ? { forkedAt: input.forkedAt } : {}),
    ...(input.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: input.forkedFromMessageCount } : {}),
    ...(input.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: input.forkedFromTurnCount } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.todos ? { todos: input.todos } : {}),
    createdAt: now,
    updatedAt: now,
    turns: []
  }
}

export function touchThread(thread: ThreadEntity, updatedAt?: string): ThreadEntity {
  return { ...thread, updatedAt: updatedAt ?? new Date().toISOString() }
}

export function toThreadSummary(
  thread: ThreadEntity
): Pick<
  ThreadEntity,
  'id' | 'title' | 'workspace' | 'model' | 'mode' | 'status' | 'createdAt' | 'updatedAt'
  | 'costBudgetUsd' | 'costBudgetWarningSent'
  | 'relation' | 'parentThreadId'
  | 'forkedFromThreadId' | 'forkedFromTitle' | 'forkedAt' | 'forkedFromMessageCount' | 'forkedFromTurnCount'
  | 'goal' | 'todos'
> {
  return {
    id: thread.id,
    title: thread.title,
    workspace: thread.workspace,
    model: thread.model,
    mode: thread.mode,
    status: thread.status,
    ...(thread.costBudgetUsd !== undefined ? { costBudgetUsd: thread.costBudgetUsd } : {}),
    ...(thread.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: thread.costBudgetWarningSent } : {}),
    relation: thread.relation ?? 'primary',
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(thread.forkedFromThreadId ? { forkedFromThreadId: thread.forkedFromThreadId } : {}),
    ...(thread.forkedFromTitle ? { forkedFromTitle: thread.forkedFromTitle } : {}),
    ...(thread.forkedAt ? { forkedAt: thread.forkedAt } : {}),
    ...(thread.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: thread.forkedFromMessageCount } : {}),
    ...(thread.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: thread.forkedFromTurnCount } : {}),
    ...(thread.goal ? { goal: thread.goal } : {}),
    ...(thread.todos ? { todos: thread.todos } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  }
}
