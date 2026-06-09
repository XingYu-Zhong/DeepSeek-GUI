/**
 * Kun HTTP endpoint path templates. The renderer and the main
 * process IPC allow-list both derive their paths from this table, so
 * adding a new endpoint is a one-file change.
 *
 * `*TEMPLATE` constants carry the `{id}` / `{turn}` placeholders
 * literally. `*PATH(...)` builders perform the URL encoding and
 * return a concrete path for runtime use.
 */

export const KUN_HEALTH_PATH = '/health'
export const KUN_HEALTH_TEMPLATE = '/health'

export const KUN_RUNTIME_INFO_PATH = '/v1/runtime/info'
export const KUN_RUNTIME_INFO_TEMPLATE = '/v1/runtime/info'

export const KUN_RUNTIME_TOOLS_PATH = '/v1/runtime/tools'
export const KUN_RUNTIME_TOOLS_TEMPLATE = '/v1/runtime/tools'

export const KUN_SKILLS_PATH = '/v1/skills'
export const KUN_SKILLS_TEMPLATE = '/v1/skills'

export const KUN_ATTACHMENTS_PATH = '/v1/attachments'
export const KUN_ATTACHMENTS_TEMPLATE = '/v1/attachments'
export const KUN_ATTACHMENT_DIAGNOSTICS_PATH = '/v1/attachments/diagnostics'
export const KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE = '/v1/attachments/diagnostics'
export const KUN_ATTACHMENT_TEMPLATE = '/v1/attachments/{id}'
export function kunAttachmentPath(attachmentId: string): string {
  return `/v1/attachments/${encodeURIComponent(attachmentId)}`
}
export const KUN_ATTACHMENT_CONTENT_TEMPLATE = '/v1/attachments/{id}/content'
export function kunAttachmentContentPath(attachmentId: string): string {
  return `${kunAttachmentPath(attachmentId)}/content`
}

export const KUN_MEMORY_PATH = '/v1/memory'
export const KUN_MEMORY_TEMPLATE = '/v1/memory'
export const KUN_MEMORY_DIAGNOSTICS_PATH = '/v1/memory/diagnostics'
export const KUN_MEMORY_DIAGNOSTICS_TEMPLATE = '/v1/memory/diagnostics'
export const KUN_MEMORY_RECORD_TEMPLATE = '/v1/memory/{id}'
export function kunMemoryRecordPath(memoryId: string): string {
  return `/v1/memory/${encodeURIComponent(memoryId)}`
}

export const KUN_THREADS_PATH = '/v1/threads'
export const KUN_THREADS_TEMPLATE = '/v1/threads'

export const KUN_THREAD_TEMPLATE = '/v1/threads/{id}'
export function kunThreadPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}`
}

export const KUN_THREAD_FORK_TEMPLATE = '/v1/threads/{id}/fork'
export function kunThreadForkPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/fork`
}

export const KUN_THREAD_GOAL_TEMPLATE = '/v1/threads/{id}/goal'
export function kunThreadGoalPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/goal`
}

export const KUN_THREAD_TODOS_TEMPLATE = '/v1/threads/{id}/todos'
export function kunThreadTodosPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/todos`
}

export const KUN_THREAD_COMPACT_TEMPLATE = '/v1/threads/{id}/compact'
export function kunThreadCompactPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/compact`
}

export const KUN_THREAD_REVIEW_TEMPLATE = '/v1/threads/{id}/review'
export function kunThreadReviewPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/review`
}

export const KUN_THREAD_TURNS_TEMPLATE = '/v1/threads/{id}/turns'
export function kunThreadTurnsPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/turns`
}

export const KUN_THREAD_STEER_TEMPLATE = '/v1/threads/{id}/turns/{turn}/steer'
export function kunThreadSteerPath(threadId: string, turnId: string): string {
  return `${kunThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}/steer`
}

export const KUN_THREAD_INTERRUPT_TEMPLATE = '/v1/threads/{id}/turns/{turn}/interrupt'
export function kunThreadInterruptPath(threadId: string, turnId: string): string {
  return `${kunThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}/interrupt`
}

export const KUN_THREAD_EVENTS_TEMPLATE = '/v1/threads/{id}/events'
export function kunThreadEventsPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/events`
}

export const KUN_APPROVAL_TEMPLATE = '/v1/approvals/{id}'
export function kunApprovalPath(approvalId: string): string {
  return `/v1/approvals/${encodeURIComponent(approvalId)}`
}

export const KUN_USER_INPUT_TEMPLATE = '/v1/user-inputs/{id}'
export function kunUserInputPath(inputId: string): string {
  return `/v1/user-inputs/${encodeURIComponent(inputId)}`
}

export const KUN_SESSION_RESUME_TEMPLATE = '/v1/sessions/{id}/resume-thread'
export function kunSessionResumePath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-thread`
}

export const KUN_USAGE_PATH = '/v1/usage'
export const KUN_USAGE_TEMPLATE = '/v1/usage'

/** Thread mode shared with the Kun contract. */
export type KunThreadMode = 'agent' | 'plan'

const THREAD_MODES: ReadonlySet<KunThreadMode> = new Set<KunThreadMode>(['agent', 'plan'])

export function isKunThreadMode(value: unknown): value is KunThreadMode {
  return typeof value === 'string' && (THREAD_MODES as Set<string>).has(value)
}

export function normalizeThreadMode(value: unknown): KunThreadMode {
  return value === 'plan' ? 'plan' : 'agent'
}
