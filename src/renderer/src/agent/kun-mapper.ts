import type {
  ChatBlock,
  CompactionEventPayload,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  ReviewOutput,
  ReviewTarget,
  RuntimeStatusEventPayload,
  ThreadGoal,
  ThreadTodoList,
  UserInputRequestPayload,
  UserMessageEventPayload,
  ThreadDeltaEvent,
  ThreadEventSink,
  ThreadUsageSnapshot,
  ToolBlock,
  ToolEventPayload,
  UserInputQuestion
} from './types'
import type {
  CoreChildRuntimeMetadataJson,
  CoreRuntimeEventJson,
  CoreThreadGoalJson,
  CoreThreadTodoListJson,
  CoreThreadSummaryJson,
  CoreTurnItemJson,
  CoreReviewOutputJson,
  CoreReviewTargetJson,
  CoreUsageSnapshotJson
} from './kun-contract'

export function buildQuery(options: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function threadFromCore(thread: CoreThreadSummaryJson): NormalizedThread {
  return {
    id: thread.id,
    title: thread.title?.trim() || thread.id.slice(0, 8),
    updatedAt: thread.updatedAt,
    model: thread.model,
    mode: thread.mode,
    workspace: thread.workspace,
    status: thread.status,
    archived: thread.status === 'archived',
    relation: thread.relation,
    parentThreadId: thread.parentThreadId,
    forkedFromThreadId: thread.forkedFromThreadId,
    forkedFromTitle: thread.forkedFromTitle,
    forkedAt: thread.forkedAt,
    forkedFromMessageCount: thread.forkedFromMessageCount,
    forkedFromTurnCount: thread.forkedFromTurnCount,
    goal: thread.goal ? goalFromCore(thread.goal) : null,
    todos: thread.todos ? todosFromCore(thread.todos) : null
  }
}

export function goalFromCore(goal: CoreThreadGoalJson): ThreadGoal {
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? 0,
    timeUsedSeconds: goal.timeUsedSeconds ?? 0,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  }
}

export function todosFromCore(todos: CoreThreadTodoListJson): ThreadTodoList {
  return {
    threadId: todos.threadId,
    items: (todos.items ?? []).map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
      ...(item.source ? { source: { ...item.source } } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })),
    updatedAt: todos.updatedAt
  }
}

function itemCreatedAt(item: CoreTurnItemJson): string | undefined {
  return item.createdAt || item.finishedAt
}

function toolStatus(item: CoreTurnItemJson): ToolBlock['status'] {
  if (item.isError || item.status === 'failed' || item.status === 'aborted') return 'error'
  if (item.status === 'pending' || item.status === 'running') return 'running'
  return 'success'
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolBlockId(item: CoreTurnItemJson): string {
  return item.callId?.trim() ? `tool_${item.callId}` : item.id
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return strings.length > 0 ? strings : undefined
}

function readStructuredString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const FILE_PATH_KEYS = [
  'absolute_path',
  'path',
  'file_path',
  'file',
  'relative_path',
  'target_path',
  'destination_path'
] as const

const COMMAND_KEYS = ['command', 'cmd', 'script'] as const
const COMMAND_RESULT_META_KEYS = [
  'exit_code',
  'session_id',
  'status',
  'pid',
  'shell',
  'cwd',
  'started_at',
  'finished_at',
  'partial',
  'stop_sent'
] as const

const TOOL_KIND_BY_NAME: ReadonlyMap<string, ToolBlock['toolKind']> = new Map([
  ['shell', 'command_execution'],
  ['bash', 'command_execution'],
  ['terminal', 'command_execution'],
  ['run_command', 'command_execution'],
  ['exec', 'command_execution'],
  ['read', 'tool_call'],
  ['write', 'file_change'],
  ['edit', 'file_change'],
  ['grep', 'tool_call'],
  ['find', 'tool_call'],
  ['ls', 'tool_call'],
  ['write_file', 'file_change'],
  ['read_file', 'file_change'],
  ['edit_file', 'file_change'],
  ['apply_patch', 'file_change'],
  ['create_file', 'file_change'],
  ['create_plan', 'file_change']
])

function payloadFor(item: CoreTurnItemJson): Record<string, unknown> {
  if (item.kind === 'tool_result') {
    return item.output && typeof item.output === 'object'
      ? (item.output as Record<string, unknown>)
      : {}
  }
  return (item.arguments ?? {}) as Record<string, unknown>
}

function normalizeChildMetadata(
  child: CoreChildRuntimeMetadataJson | undefined
): CoreChildRuntimeMetadataJson | undefined {
  if (!child?.childId || !child.parentThreadId || !child.parentTurnId) return undefined
  return {
    parentThreadId: child.parentThreadId,
    parentTurnId: child.parentTurnId,
    childId: child.childId,
    ...(child.childLabel ? { childLabel: child.childLabel } : {}),
    childStatus: child.childStatus,
    childSeq: child.childSeq
  }
}

function normalizeWebSources(value: unknown): Array<Record<string, string>> | undefined {
  if (!Array.isArray(value)) return undefined
  const sources = value
    .map((source) => {
      if (!source || typeof source !== 'object') return null
      const raw = source as Record<string, unknown>
      const normalized: Record<string, string> = {}
      for (const key of ['sourceId', 'url', 'title', 'retrievedAt'] as const) {
        const entry = raw[key]
        if (typeof entry === 'string' && entry.trim()) normalized[key] = entry.trim()
      }
      return Object.keys(normalized).length > 0 ? normalized : null
    })
    .filter((source): source is Record<string, string> => source !== null)
  return sources.length > 0 ? sources : undefined
}

function applyRuntimeDisclosureMeta(
  meta: Record<string, unknown>,
  item: CoreTurnItemJson,
  child?: CoreChildRuntimeMetadataJson
): void {
  const attachmentIds = stringArray(item.attachmentIds)
  const activeSkillIds = stringArray(item.activeSkillIds)
  const injectedMemoryIds = stringArray(item.injectedMemoryIds)
  const normalizedChild = normalizeChildMetadata(child)
  const displayText = typeof item.displayText === 'string' ? item.displayText.trim() : ''
  if (displayText && displayText !== item.text?.trim()) {
    meta.displayText = displayText
  }
  if (attachmentIds) meta.attachmentIds = attachmentIds
  if (activeSkillIds) meta.activeSkillIds = activeSkillIds
  if (injectedMemoryIds) meta.injectedMemoryIds = injectedMemoryIds
  if (typeof item.skillInjectionBytes === 'number') {
    meta.skillInjectionBytes = item.skillInjectionBytes
  }
  if (normalizedChild) meta.child = normalizedChild
}

function extractToolSources(item: CoreTurnItemJson): Array<Record<string, string>> | undefined {
  const payload = payloadFor(item)
  return normalizeWebSources(payload.sources) ?? normalizeWebSources(payload.citations)
}

function applyCommandResultMeta(meta: Record<string, unknown>, item: CoreTurnItemJson): void {
  const payload = payloadFor(item)
  for (const key of COMMAND_RESULT_META_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = value
    }
  }
}

function inferToolPresentation(item: CoreTurnItemJson): {
  toolKind: ToolBlock['toolKind']
  filePath?: string
  command?: string
} {
  const payload = payloadFor(item)
  const filePath = readStructuredString(payload, ...FILE_PATH_KEYS)
  const command = readStructuredString(payload, ...COMMAND_KEYS)

  if (
    item.toolKind === 'tool_call' ||
    item.toolKind === 'command_execution' ||
    item.toolKind === 'file_change'
  ) {
    return {
      toolKind: item.toolKind,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  const toolName = item.toolName?.trim() ?? ''
  const byName = TOOL_KIND_BY_NAME.get(toolName)
  if (byName) {
    return {
      toolKind: byName,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  // Payload-only fallback. Prefer the kind whose field is present
  // on the payload; if both are present, the explicit command wins
  // (matches the previous heuristic and what the tests assert).
  if (command) {
    return { toolKind: 'command_execution', command }
  }
  if (filePath) {
    return { toolKind: 'file_change', filePath }
  }
  return { toolKind: 'tool_call' }
}

function isPlanItem(item: CoreTurnItemJson): boolean {
  if (item.toolName === 'create_plan') return true
  if (item.kind === 'tool_result' && isPlanOutput(item.output)) return true
  return false
}

function isPlanOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const candidate = output as Record<string, unknown>
  return (
    typeof candidate.plan_id === 'string' &&
    typeof candidate.relative_path === 'string' &&
    typeof candidate.workspace_root === 'string' &&
    (candidate.operation === 'draft' || candidate.operation === 'refine')
  )
}

function extractPlanMetadata(item: CoreTurnItemJson): Record<string, unknown> | null {
  const source = item.kind === 'tool_result' ? item.output : item.arguments
  if (!source || typeof source !== 'object') return null
  const candidate = source as Record<string, unknown>
  const plan: Record<string, unknown> = {}
  if (typeof candidate.plan_id === 'string') plan.plan_id = candidate.plan_id
  if (typeof candidate.workspace_root === 'string') plan.workspace_root = candidate.workspace_root
  if (typeof candidate.relative_path === 'string') plan.relative_path = candidate.relative_path
  if (typeof candidate.absolute_path === 'string') plan.absolute_path = candidate.absolute_path
  if (typeof candidate.source_request === 'string') plan.source_request = candidate.source_request
  if (typeof candidate.title === 'string') plan.title = candidate.title
  if (candidate.operation === 'draft' || candidate.operation === 'refine') {
    plan.operation = candidate.operation
  }
  if (typeof candidate.saved_at === 'string') plan.saved_at = candidate.saved_at
  if (typeof candidate.content_hash === 'string') plan.content_hash = candidate.content_hash
  if (typeof candidate.byte_size === 'number') plan.byte_size = candidate.byte_size
  if (item.kind === 'tool_result' && item.isError) {
    plan.error = typeof candidate.error === 'string' ? candidate.error : 'create_plan failed'
  }
  return Object.keys(plan).length > 0 ? plan : null
}

function toolBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ToolBlock {
  const detail = item.kind === 'tool_result' ? outputText(item.output) : outputText(item.arguments)
  const isPlan = isPlanItem(item)
  const summary =
    item.summary?.trim() ||
    (isPlan ? 'Create plan' : null) ||
    item.toolName?.trim() ||
    (item.kind === 'tool_result' ? 'tool result' : 'tool')
  const meta: Record<string, unknown> = {
    sourceItemId: item.id,
    ...(item.callId ? { callId: item.callId } : {}),
    ...(item.toolName ? { toolName: item.toolName } : {})
  }
  applyRuntimeDisclosureMeta(meta, item, child)
  const sources = extractToolSources(item)
  if (sources) meta.sources = sources
  const presentation = inferToolPresentation(item)
  if (presentation.command) meta.command = presentation.command
  if (presentation.toolKind === 'command_execution') applyCommandResultMeta(meta, item)
  if (isPlan) {
    const plan = extractPlanMetadata(item)
    if (plan) meta.plan = plan
  }
  return {
    kind: 'tool',
    id: toolBlockId(item),
    createdAt: itemCreatedAt(item),
    summary,
    status: toolStatus(item),
    toolKind: presentation.toolKind,
    ...(presentation.filePath ? { filePath: presentation.filePath } : {}),
    ...(detail ? { detail } : {}),
    meta
  }
}

export function mergeChatBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const merged: ChatBlock[] = []
  const toolIndexes = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind !== 'tool') {
      merged.push(block)
      continue
    }
    const existingIndex = toolIndexes.get(block.id)
    if (existingIndex === undefined) {
      toolIndexes.set(block.id, merged.length)
      merged.push(block)
      continue
    }
    const existing = merged[existingIndex]
    if (!existing || existing.kind !== 'tool') {
      merged.push(block)
      continue
    }
    merged[existingIndex] = {
      ...existing,
      ...block,
      createdAt: existing.createdAt ?? block.createdAt,
      summary: block.summary || existing.summary,
      detail: block.detail ?? existing.detail,
      filePath: block.filePath ?? existing.filePath,
      toolKind: block.toolKind ?? existing.toolKind,
      meta: { ...(existing.meta ?? {}), ...(block.meta ?? {}) }
    }
  }
  return merged
}

function userInputQuestionsFromItem(item: CoreTurnItemJson): UserInputQuestion[] {
  return questionsFromCore(item.questions, item.prompt, item.inputId ?? item.id)
}

function questionsFromCore(
  questions: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions'] | undefined,
  prompt: string | undefined,
  fallbackId: string
): UserInputQuestion[] {
  if (Array.isArray(questions) && questions.length > 0) {
    return questions
      .map((question) => normalizeUserInputQuestion(question))
      .filter((question): question is UserInputQuestion => question !== null)
  }
  return [
    {
      header: 'Input',
      id: fallbackId,
      question: prompt?.trim() || 'Input requested',
      options: [{ label: 'Submit', description: 'Send the typed response.' }]
    }
  ]
}

function normalizeUserInputQuestion(question: unknown): UserInputQuestion | null {
  if (!question || typeof question !== 'object') return null
  const raw = question as Record<string, unknown>
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option): option is UserInputQuestion['options'][number] => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : 'Input',
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'input',
    question: typeof raw.question === 'string' && raw.question.trim() ? raw.question.trim() : 'Input requested',
    options
  }
}

function normalizeUserInputOption(option: unknown): UserInputQuestion['options'][number] | null {
  if (!option || typeof option !== 'object') return null
  const raw = option as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

function usageFromCore(usage: CoreUsageSnapshotJson): ThreadUsageSnapshot {
  const inputTokens = usage.promptTokens ?? 0
  const outputTokens = usage.completionTokens ?? 0
  const hasHitTokens = typeof usage.cacheHitTokens === 'number' && Number.isFinite(usage.cacheHitTokens)
  const hasMissTokens = typeof usage.cacheMissTokens === 'number' && Number.isFinite(usage.cacheMissTokens)
  const cachedTokens = hasHitTokens ? usage.cacheHitTokens ?? 0 : 0
  const cacheMissTokens = hasMissTokens ? usage.cacheMissTokens ?? 0 : 0
  const cacheTotal = cachedTokens + cacheMissTokens
  const cacheHitRate = typeof usage.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)
    ? usage.cacheHitRate
    : hasHitTokens && hasMissTokens && cacheTotal > 0
      ? cachedTokens / cacheTotal
      : null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costUsd: usage.costUsd ?? 0,
    costCny: usage.costCny ?? null,
    cacheSavingsUsd: usage.cacheSavingsUsd ?? 0,
    cacheSavingsCny: usage.cacheSavingsCny ?? null,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens ?? 0,
    tokenEconomySavingsUsd: usage.tokenEconomySavingsUsd ?? 0,
    tokenEconomySavingsCny: usage.tokenEconomySavingsCny ?? null,
    turns: usage.turns ?? 0
  }
}

function userMessageBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item)
  return {
    kind: 'user',
    id: item.id,
    createdAt: itemCreatedAt(item),
    text: item.text ?? '',
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  }
}

function userMessageEventFromItem(item: CoreTurnItemJson): UserMessageEventPayload {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item)
  return {
    itemId: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: item.text ?? '',
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  }
}

function assistantTextBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'assistant', id: item.id, createdAt: itemCreatedAt(item), text: item.text }
}

function reasoningBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'reasoning', id: item.id, createdAt: itemCreatedAt(item), text: item.text }
}

function approvalBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ChatBlock {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item, child)
  return {
    kind: 'approval',
    id: item.id,
    createdAt: itemCreatedAt(item),
    approvalId: item.approvalId ?? item.id,
    summary: item.summary?.trim() || 'Approval required',
    toolName: item.toolName,
    status:
      item.status === 'allowed' || item.status === 'denied'
        ? item.status
        : item.status === 'failed'
          ? 'error'
          : 'pending',
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  }
}

function userInputBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'user_input',
    id: item.id,
    createdAt: itemCreatedAt(item),
    requestId: item.inputId ?? item.id,
    questions: userInputQuestionsFromItem(item),
    status:
      item.status === 'failed'
        ? 'error'
        : item.status === 'completed'
          ? 'submitted'
          : 'pending'
  }
}

function userInputRequestFromCore(input: {
  itemId?: string
  inputId?: string
  prompt?: string
  questions?: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions']
  seq?: number
}): UserInputRequestPayload {
  const fallbackId = input.inputId ?? input.itemId ?? `input_${input.seq ?? Date.now()}`
  return {
    itemId: input.itemId ?? fallbackId,
    requestId: input.inputId ?? fallbackId,
    questions: questionsFromCore(input.questions, input.prompt, input.inputId ?? fallbackId)
  }
}

function compactionBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'compaction',
    id: item.id,
    createdAt: itemCreatedAt(item),
    summary: item.summary?.trim() || 'Context compacted',
    status: item.status === 'failed' ? 'error' : 'success',
    messagesBefore: item.replacedTokens,
    detail: item.pinnedConstraints?.join('\n'),
    auto: true
  }
}

function reviewStatus(item: CoreTurnItemJson): ReviewEventPayload['status'] {
  if (item.status === 'pending' || item.status === 'running') return 'running'
  if (item.status === 'failed' || item.status === 'aborted') return 'error'
  return 'success'
}

function reviewTargetFromCore(target: CoreReviewTargetJson | undefined): ReviewTarget | undefined {
  if (!target || typeof target.kind !== 'string') return undefined
  switch (target.kind) {
    case 'uncommittedChanges':
      return { kind: 'uncommittedChanges' }
    case 'baseBranch':
      return target.branch?.trim() ? { kind: 'baseBranch', branch: target.branch } : undefined
    case 'commit':
      return target.sha?.trim() ? { kind: 'commit', sha: target.sha } : undefined
    case 'custom':
      return target.instructions?.trim()
        ? { kind: 'custom', instructions: target.instructions }
        : undefined
    default:
      return undefined
  }
}

function reviewOutputFromCore(output: unknown): ReviewOutput | undefined {
  if (!isCoreReviewOutput(output)) return undefined
  return {
    findings: (output.findings ?? []).map((finding) => ({
      title: finding.title,
      body: finding.body,
      confidenceScore: finding.confidenceScore,
      priority: finding.priority,
      codeLocation: {
        absoluteFilePath: finding.codeLocation.absoluteFilePath,
        lineRange: {
          start: finding.codeLocation.lineRange.start,
          end: finding.codeLocation.lineRange.end
        }
      }
    })),
    overallCorrectness: output.overallCorrectness,
    overallExplanation: output.overallExplanation,
    overallConfidenceScore: output.overallConfidenceScore
  }
}

function isCoreReviewOutput(value: unknown): value is CoreReviewOutputJson {
  if (!value || typeof value !== 'object') return false
  const raw = value as Partial<CoreReviewOutputJson>
  return (
    Array.isArray(raw.findings) &&
    (raw.overallCorrectness === 'patch is correct' || raw.overallCorrectness === 'patch is incorrect') &&
    typeof raw.overallExplanation === 'string' &&
    typeof raw.overallConfidenceScore === 'number'
  )
}

function reviewBlockFromItem(item: CoreTurnItemJson): ReviewBlock {
  return {
    kind: 'review',
    id: item.id,
    createdAt: itemCreatedAt(item),
    title: item.title?.trim() || 'Code review',
    status: reviewStatus(item),
    target: reviewTargetFromCore(item.target),
    reviewText: item.reviewText,
    output: reviewOutputFromCore(item.output)
  }
}

function systemErrorBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'system',
    id: item.id,
    createdAt: itemCreatedAt(item),
    text: item.message ?? 'Runtime error'
  }
}

/**
 * Build a `ChatBlock` from a turn item. Used both for replaying a
 * thread (load path) and as the canonical per-kind view that the
 * live event dispatcher maps onto sink callbacks.
 */
export function chatBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ChatBlock | null {
  switch (item.kind) {
    case 'user_message':
      return userMessageBlockFromItem(item)
    case 'assistant_text':
      return assistantTextBlockFromItem(item)
    case 'assistant_reasoning':
      return reasoningBlockFromItem(item)
    case 'tool_call':
    case 'tool_result':
      return toolBlockFromItem(item, child)
    case 'approval':
      return approvalBlockFromItem(item, child)
    case 'user_input':
      return userInputBlockFromItem(item)
    case 'compaction':
      return compactionBlockFromItem(item)
    case 'review':
      return reviewBlockFromItem(item)
    case 'error':
      return systemErrorBlockFromItem(item)
    default:
      return null
  }
}

function toolEventFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ToolEventPayload {
  const block = toolBlockFromItem(item, child)
  return {
    itemId: block.id,
    summary: block.summary,
    status: block.status,
    toolKind: block.toolKind,
    detail: block.detail,
    filePath: block.filePath,
    meta: block.meta
  }
}

function compactionFromItem(item: CoreTurnItemJson): CompactionEventPayload {
  return {
    itemId: item.id,
    summary: item.summary?.trim() || 'Context compacted',
    status: item.status === 'failed' ? 'error' : item.status === 'running' ? 'running' : 'success',
    createdAt: itemCreatedAt(item),
    messagesBefore: item.replacedTokens,
    detail: item.pinnedConstraints?.length ? item.pinnedConstraints.join('\n') : undefined,
    auto: true
  }
}

function reviewFromItem(item: CoreTurnItemJson): ReviewEventPayload {
  const block = reviewBlockFromItem(item)
  return {
    itemId: block.id,
    createdAt: block.createdAt,
    title: block.title,
    status: block.status,
    target: block.target,
    reviewText: block.reviewText,
    output: block.output
  }
}

/**
 * Dispatch a turn item to a live thread sink. The replay path uses
 * `chatBlockFromItem` directly; this function maps item snapshots onto
 * the `ThreadEventSink` callbacks that the chat store understands.
 */
function emitItem(
  item: CoreTurnItemJson,
  sink: ThreadEventSink,
  child?: CoreChildRuntimeMetadataJson
): void {
  switch (item.kind) {
    case 'user_message':
      sink.onUserMessage(userMessageEventFromItem(item))
      return
    case 'assistant_text':
    case 'assistant_reasoning':
      // Live text/reasoning arrives through *_delta events. Item events are
      // snapshots for replay/load paths and would duplicate streamed content.
      return
    case 'tool_call':
    case 'tool_result':
      sink.onTool(toolEventFromItem(item, child))
      return
    // Approval and user_input have dedicated runtime events; the
    // generic item path would otherwise double-emit them.
    case 'approval':
    case 'user_input':
      return
    case 'compaction':
      sink.onCompaction(compactionFromItem(item))
      return
    case 'review':
      sink.onReview?.(reviewFromItem(item))
      return
    case 'error':
      sink.onError(new Error(item.message ?? 'Kun item failed'))
      return
  }
}

function emitDelta(
  event: CoreRuntimeEventJson,
  sink: ThreadEventSink,
  kind: ThreadDeltaEvent['kind']
): void {
  const text = event.item?.text ?? ''
  if (!text) return
  sink.onDeltas([{ text, kind, seq: event.seq }])
}

function compactionFromEvent(
  event: CoreRuntimeEventJson,
  status: CompactionEventPayload['status']
): CompactionEventPayload {
  return {
    itemId: event.itemId ?? `compaction_${event.seq ?? Date.now()}`,
    summary: event.summary ?? 'Context compacted',
    status,
    createdAt: event.timestamp,
    messagesBefore: event.replacedTokens,
    detail: event.pinnedConstraints?.join('\n'),
    auto: true
  }
}

function toolReadyFromEvent(event: CoreRuntimeEventJson): ToolEventPayload | null {
  const callId = typeof event.callId === 'string' && event.callId.trim() ? event.callId.trim() : ''
  const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
  if (!callId || !toolName) return null
  return {
    itemId: `tool_${callId}`,
    summary: toolName,
    status: 'running',
    toolKind: 'tool_call',
    meta: {
      ...(event.itemId ? { sourceItemId: event.itemId } : {}),
      callId,
      toolName,
      ...(typeof event.readyCount === 'number' ? { readyCount: event.readyCount } : {}),
      runtimeStatus: 'tool_call_ready'
    }
  }
}

function runtimeStatusFromEvent(event: CoreRuntimeEventJson): RuntimeStatusEventPayload | null {
  if (event.kind === 'error' && event.code === 'compaction_summary_fallback') {
    const key = event.turnId ?? event.threadId ?? event.seq ?? Date.now()
    return {
      kind: 'compaction_summary_fallback',
      itemId: `runtime_status_${key}_compaction_summary_fallback`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      message: event.message
    }
  }
  if (event.kind === 'tool_result_upload_wait') {
    const turnKey = event.turnId ?? event.threadId ?? event.seq ?? Date.now()
    return {
      kind: 'tool_result_upload_wait',
      itemId: `runtime_status_${turnKey}_tool_upload_wait`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      toolResultCount: typeof event.toolResultCount === 'number' ? event.toolResultCount : 0
    }
  }
	  if (event.kind === 'tool_catalog_changed') {
	    const key = event.fingerprint ?? event.seq ?? Date.now()
	    return {
	      kind: 'tool_catalog_changed',
	      itemId: `runtime_status_tool_catalog_${key}`,
	      turnId: event.turnId,
	      createdAt: event.timestamp,
	      ...(event.changeKind ? { changeKind: event.changeKind } : {}),
	      message: event.message
	    }
	  }
	  if (event.kind === 'tool_storm_suppressed') {
	    const callId = typeof event.callId === 'string' && event.callId.trim() ? event.callId.trim() : ''
	    const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
	    if (!callId || !toolName) return null
	    return {
	      kind: 'tool_storm_suppressed',
	      itemId: event.itemId ?? `runtime_status_tool_storm_${callId}`,
	      turnId: event.turnId,
	      createdAt: event.timestamp,
	      message: event.message,
	      toolName,
	      callId
	    }
	  }
	  return null
	}

export async function dispatchKunRuntimeEvent(
  event: CoreRuntimeEventJson,
  sink: ThreadEventSink,
  handleApprovalRequest: (event: CoreRuntimeEventJson, sink: ThreadEventSink) => Promise<void>
): Promise<void> {
  switch (event.kind) {
    case 'assistant_text_delta':
      emitDelta(event, sink, 'agent_message')
      return
    case 'assistant_reasoning_delta':
      emitDelta(event, sink, 'agent_reasoning')
      return
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
    case 'tool_call_started':
    case 'tool_call_finished':
      if (event.item) emitItem(event.item, sink, event.child)
      return
    case 'tool_call_ready': {
      const tool = toolReadyFromEvent(event)
      if (tool) sink.onTool(tool)
      return
    }
    case 'tool_result_upload_wait': {
      const status = runtimeStatusFromEvent(event)
      if (status) sink.onRuntimeStatus?.(status)
      return
    }
	    case 'tool_catalog_changed': {
	      const status = runtimeStatusFromEvent(event)
	      if (status) sink.onRuntimeStatus?.(status)
	      return
	    }
	    case 'tool_storm_suppressed': {
	      const status = runtimeStatusFromEvent(event)
	      if (status) sink.onRuntimeStatus?.(status)
	      return
	    }
    case 'approval_requested':
      await handleApprovalRequest(event, sink)
      return
    case 'user_input_requested':
      sink.onUserInput(
        userInputRequestFromCore({
          itemId: event.itemId,
          inputId: event.inputId,
          prompt: event.prompt,
          questions: event.questions,
          seq: event.seq
        })
      )
      return
    case 'user_input_resolved':
      sink.onUserInputStatus({
        itemId: event.itemId ?? event.inputId ?? `input_${event.seq ?? Date.now()}`,
        status: event.status === 'cancelled' ? 'cancelled' : 'submitted'
      })
      return
    case 'compaction_started':
      sink.onCompaction(compactionFromEvent(event, 'running'))
      return
    case 'compaction_completed':
      sink.onCompaction(compactionFromEvent(event, 'success'))
      return
    case 'goal_updated':
      sink.onGoal({
        threadId: event.threadId ?? event.goal?.threadId ?? '',
        goal: event.goal ? goalFromCore(event.goal) : null,
        createdAt: event.timestamp
      })
      return
    case 'goal_cleared':
      sink.onGoal({
        threadId: event.threadId ?? '',
        goal: null,
        cleared: true,
        createdAt: event.timestamp
      })
      return
    case 'todos_updated':
      sink.onTodos?.({
        threadId: event.threadId ?? event.todos?.threadId ?? '',
        todos: event.todos ? todosFromCore(event.todos) : null,
        createdAt: event.timestamp
      })
      return
    case 'todos_cleared':
      sink.onTodos?.({
        threadId: event.threadId ?? '',
        todos: null,
        cleared: true,
        createdAt: event.timestamp
      })
      return
    case 'usage':
      if (event.usage) sink.onUsage?.(usageFromCore(event.usage))
      return
    case 'turn_completed':
    case 'turn_aborted':
      sink.onTurnComplete()
      return
    case 'turn_failed':
    case 'error':
      if (event.code === 'compaction_summary_fallback') {
        const status = runtimeStatusFromEvent(event)
        if (status) sink.onRuntimeStatus?.(status)
        return
      }
      sink.onError(new Error(event.message ?? 'Kun turn failed'))
      return
    default:
      return
  }
}
