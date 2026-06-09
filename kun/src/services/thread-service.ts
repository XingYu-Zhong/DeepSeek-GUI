import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type {
  CreateThreadRequest,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  ThreadGoal,
  ThreadMode,
  ThreadRecord,
  ThreadRelation,
  ThreadStatus,
  ThreadTodoItem,
  ThreadTodoList,
  ThreadTodoSource,
  ThreadTodoStatus,
  ThreadSummary
} from '../contracts/threads.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import type { Turn } from '../contracts/turns.js'
import type { TurnItem } from '../contracts/items.js'
import { createThreadRecord, toThreadSummary, touchThread } from '../domain/thread.js'
import type { AgentSession } from '../domain/session.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { withFileMutationQueue } from '../adapters/tool/file-mutation-queue.js'
import { DEFAULT_KUN_MODEL } from '../config/kun-config.js'
import { isGuiPlanRelativePath } from '../shared/gui-plan.js'
import {
  extractPlanTodos,
  mergePlanTodos,
  normalizePlanRelativePath,
  normalizeTodoContent,
  patchPlanTodoStatus,
  todoContentHash
} from '../shared/todos.js'

export type ThreadServiceOptions = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  ids: IdGenerator
  nowIso: () => string
}

export type ListThreadsOptions = ThreadStoreListOptions

export type ForkThreadOptions = {
  relation?: ThreadRelation
  title?: string
}

export type ResumeSessionOptions = {
  workspace?: string
  model?: string
  mode?: ThreadMode
}

export type ResumeSessionResult = {
  thread: ThreadRecord
  sessionId: string
  messageCount: number
}

export type SyncPlanTodosOptions = {
  planId: string
  relativePath: string
  markdown: string
  preserveCompleted?: boolean
}

export class ThreadService {
  private readonly threadStore: ThreadStore
  private readonly sessionStore: SessionStore
  private readonly events: RuntimeEventRecorder
  private readonly ids: IdGenerator
  private readonly nowIso: () => string

  constructor(options: ThreadServiceOptions) {
    this.threadStore = options.threadStore
    this.sessionStore = options.sessionStore
    this.events = options.events
    this.ids = options.ids
    this.nowIso = options.nowIso
  }

  async list(options: ListThreadsOptions = {}): Promise<ThreadSummary[]> {
    const query = options.search?.trim().toLowerCase()
    let threads = await this.threadStore.list(options)
    if (options.archivedOnly) {
      threads = threads.filter((thread) => thread.status === 'archived')
    } else if (!options.includeArchived) {
      threads = threads.filter((thread) => thread.status !== 'archived' && thread.status !== 'deleted')
    }
    if (!options.includeSide) {
      threads = threads.filter((thread) => (thread.relation ?? 'primary') !== 'side')
    }
    if (query) {
      threads = threads.filter((thread) => matchesThreadSearch(thread, query))
    }
    return typeof options.limit === 'number' ? threads.slice(0, options.limit) : threads
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    return this.threadStore.get(threadId)
  }

  async create(
    request: CreateThreadRequest,
    options: { id?: string; title?: string; status?: ThreadStatus } = {}
  ): Promise<ThreadRecord> {
    // Always advance the id generator so externally-supplied ids
    // don't collide with later allocations from `fork`/etc.
    const generated = this.ids.next('thr')
    const id = options.id ?? generated
    const thread = createThreadRecord({
      id,
      title: options.title ?? (request.title?.trim() || 'New chat'),
      workspace: request.workspace,
      model: request.model,
      mode: request.mode,
      approvalPolicy: request.approvalPolicy,
      sandboxMode: request.sandboxMode,
      ...(request.costBudgetUsd !== undefined ? { costBudgetUsd: request.costBudgetUsd } : {}),
      status: options.status
    })
    await this.threadStore.upsert(thread)
    await this.events.record({
      kind: 'thread_created',
      threadId: thread.id,
      title: thread.title
    })
    return thread
  }

  async update(threadId: string, patch: {
    title?: string
    status?: ThreadStatus
    approvalPolicy?: ApprovalPolicy
    sandboxMode?: SandboxMode
    costBudgetUsd?: number | null
    costBudgetWarningSent?: boolean
    relation?: ThreadRelation
  }): Promise<ThreadRecord> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    const { costBudgetUsd, costBudgetWarningSent, ...standardPatch } = patch
    const merged: ThreadRecord = { ...current, ...standardPatch }
    if (costBudgetUsd === null) {
      delete (merged as { costBudgetUsd?: number }).costBudgetUsd
      delete (merged as { costBudgetWarningSent?: boolean }).costBudgetWarningSent
    } else if (costBudgetUsd !== undefined) {
      merged.costBudgetUsd = costBudgetUsd
      merged.costBudgetWarningSent = false
    } else if (costBudgetWarningSent !== undefined) {
      merged.costBudgetWarningSent = costBudgetWarningSent
    }
    if (patch.relation !== undefined && patch.relation !== 'side') {
      // Promoting a side thread clears the parent link so the thread
      // surfaces in the default list as a standalone primary thread.
      delete (merged as { parentThreadId?: string }).parentThreadId
    }
    const updated = touchThread(merged, this.nowIso())
    await this.threadStore.upsert(updated)
    await this.events.record({
      kind: 'thread_updated',
      threadId,
      title: updated.title,
      status: updated.status
    })
    return updated
  }

  async getGoal(threadId: string): Promise<ThreadGoal | null> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    return current.goal ?? null
  }

  async setGoal(threadId: string, request: SetThreadGoalRequest): Promise<ThreadGoal> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    if (!current.goal && !request.objective) {
      throw new Error(`cannot update goal for thread ${threadId}: no goal exists`)
    }

    const now = this.nowIso()
    const existing = current.goal
    const objective = request.objective?.trim()
    const goal: ThreadGoal = {
      threadId,
      objective: objective ?? existing?.objective ?? '',
      status: request.status ?? (objective ? 'active' : existing?.status ?? 'active'),
      ...(request.tokenBudget !== undefined
        ? request.tokenBudget === null
          ? {}
          : { tokenBudget: request.tokenBudget }
        : existing?.tokenBudget !== undefined
          ? { tokenBudget: existing.tokenBudget }
          : {}),
      tokensUsed: existing?.tokensUsed ?? 0,
      timeUsedSeconds: existing?.timeUsedSeconds ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }

    const updated = touchThread({ ...current, goal }, now)
    await this.threadStore.upsert(updated)
    await this.events.record({
      kind: 'goal_updated',
      threadId,
      goal
    })
    return goal
  }

  async clearGoal(threadId: string): Promise<boolean> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    if (!current.goal) {
      return false
    }
    const updated = touchThread({ ...current }, this.nowIso())
    delete (updated as { goal?: ThreadGoal }).goal
    await this.threadStore.upsert(updated)
    await this.events.record({
      kind: 'goal_cleared',
      threadId,
      cleared: true
    })
    return true
  }

  async getTodos(threadId: string): Promise<ThreadTodoList | null> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    return current.todos ?? null
  }

  async setTodos(threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    const now = this.nowIso()
    const items = normalizeTodoItems({
      rawItems: request.todos,
      existingItems: current.todos?.items ?? [],
      now,
      ids: this.ids
    })
    await this.patchPlanMarkdownForTodoStatusChanges(current, items)
    const todos: ThreadTodoList = {
      threadId,
      items,
      updatedAt: now
    }
    const updated = touchThread({ ...current, todos }, now)
    await this.threadStore.upsert(updated)
    await this.events.record({
      kind: 'todos_updated',
      threadId,
      todos
    })
    return todos
  }

  async clearTodos(threadId: string): Promise<boolean> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    if (!current.todos) return false
    const updated = touchThread({ ...current }, this.nowIso())
    delete (updated as { todos?: ThreadTodoList }).todos
    await this.threadStore.upsert(updated)
    await this.events.record({
      kind: 'todos_cleared',
      threadId,
      cleared: true
    })
    return true
  }

  async syncTodosFromPlan(threadId: string, options: SyncPlanTodosOptions): Promise<ThreadTodoList> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    const relativePath = normalizePlanRelativePath(options.relativePath)
    if (!isGuiPlanRelativePath(relativePath)) {
      throw new Error(`invalid GUI plan relative path: ${options.relativePath}`)
    }
    const now = this.nowIso()
    const planItems = extractPlanTodos({
      markdown: options.markdown,
      planId: options.planId,
      relativePath,
      threadId,
      now
    })
    const todos = mergePlanTodos({
      threadId,
      existing: current.todos ?? null,
      planItems,
      now,
      preserveCompleted: options.preserveCompleted ?? true
    })
    const updated = touchThread({ ...current, todos }, now)
    await this.threadStore.upsert(updated)
    await this.events.record({
      kind: 'todos_updated',
      threadId,
      todos
    })
    return todos
  }

  private async patchPlanMarkdownForTodoStatusChanges(
    current: ThreadRecord,
    nextItems: readonly ThreadTodoItem[]
  ): Promise<void> {
    const previousById = new Map((current.todos?.items ?? []).map((item) => [item.id, item]))
    const changedPlanItems = nextItems.filter((item) => {
      if (item.source?.kind !== 'plan') return false
      const previous = previousById.get(item.id)
      return !previous || previous.status !== item.status
    })
    if (changedPlanItems.length === 0) return

    const byRelativePath = new Map<string, ThreadTodoItem[]>()
    for (const item of changedPlanItems) {
      const source = item.source
      if (!source || source.kind !== 'plan') continue
      const relativePath = normalizePlanRelativePath(source.relativePath)
      if (!isGuiPlanRelativePath(relativePath)) {
        throw new Error(`invalid GUI plan relative path: ${source.relativePath}`)
      }
      byRelativePath.set(relativePath, [...(byRelativePath.get(relativePath) ?? []), item])
    }

    for (const [relativePath, items] of byRelativePath) {
      const absolutePath = resolveWorkspaceRelativePath(current.workspace, relativePath)
      await withFileMutationQueue(absolutePath, async () => {
        let markdown = await readFile(absolutePath, 'utf-8')
        let changed = false
        for (const item of items) {
          const patched = patchPlanTodoStatus(markdown, {
            content: item.content,
            status: item.status,
            source: item.source
          })
          markdown = patched.markdown
          changed ||= patched.changed
        }
        if (changed) await writeFile(absolutePath, markdown, 'utf-8')
      })
    }
  }

  async delete(threadId: string): Promise<boolean> {
    const ok = await this.threadStore.delete(threadId)
    if (!ok) return false
    return true
  }

  async fork(threadId: string, options: ForkThreadOptions = {}): Promise<ThreadRecord> {
    const current = await this.threadStore.get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    const now = this.nowIso()
    const forkId = this.ids.next('thr')
    const relation: ThreadRelation = options.relation ?? 'fork'
    // Snapshot semantics: clone each turn as it stands now. The parent
    // loop keeps mutating its own record; we copy, never borrow.
    const clonedTurns = current.turns.map((turn) =>
      cloneTurnForFork(turn, forkId, now, { relation })
    )
    const clonedItems = clonedTurns.flatMap((turn) => turn.items)
    const defaultTitle = relation === 'side' ? `${current.title} · side` : `${current.title} fork`
    const fork = createThreadRecord({
      id: forkId,
      title: options.title?.trim() || defaultTitle,
      workspace: current.workspace,
      model: current.model,
      mode: current.mode,
      status: 'idle',
      approvalPolicy: current.approvalPolicy,
      sandboxMode: current.sandboxMode,
      relation,
      parentThreadId: current.id,
      forkedFromThreadId: current.id,
      forkedFromTitle: current.title,
      forkedAt: now,
      forkedFromMessageCount: clonedItems.filter((item) => item.kind === 'user_message').length,
      forkedFromTurnCount: clonedTurns.length,
      ...(current.todos ? { todos: cloneTodoListForThread(current.todos, forkId, now) } : {}),
      createdAt: now
    })
    const record: ThreadRecord = {
      ...fork,
      updatedAt: now,
      turns: clonedTurns
    }
    for (const item of clonedItems) {
      await this.sessionStore.appendItem(record.id, item)
    }
    await this.threadStore.upsert(record)
    await this.events.record({
      kind: 'thread_created',
      threadId: record.id,
      title: record.title
    })
    return record
  }

  async resumeSession(
    sessionId: string,
    options: ResumeSessionOptions = {}
  ): Promise<ResumeSessionResult> {
    const sourceThread = await this.threadStore.get(sessionId)
    const sourceSession = await this.sessionStore.loadSession(sessionId)
    const sourceItems = sourceThread
      ? sourceThread.turns.flatMap((turn) => turn.items)
      : sourceSession?.items.length
        ? sourceSession.items
        : await this.sessionStore.loadItems(sessionId)
    if (!sourceThread && !sourceSession && sourceItems.length === 0) {
      throw new Error(`session not found: ${sessionId}`)
    }

    const now = this.nowIso()
    const threadId = this.ids.next('thr')
    const sourceTurns = sourceThread
      ? sourceThread.turns
      : rebuildTurnsFromItems({
          items: sourceItems,
          threadId,
          fallbackTurnId: sourceSession?.turnId ?? this.ids.next('turn'),
          fallbackPrompt: `Resumed session ${sessionId.slice(0, 8)}`,
          now
        })
    const clonedTurns = sourceTurns.map((turn) => cloneTurnForThread(turn, threadId, now))
    const clonedItems = clonedTurns.flatMap((turn) => turn.items)
    const sourceTitle = sourceThread?.title ?? `Session ${sessionId.slice(0, 8)}`
    const record = createThreadRecord({
      id: threadId,
      title: `${sourceTitle} resumed`,
      workspace: options.workspace ?? sourceThread?.workspace ?? '~',
      model: options.model ?? sourceThread?.model ?? DEFAULT_KUN_MODEL,
      mode: options.mode ?? sourceThread?.mode ?? 'agent',
      status: 'idle',
      approvalPolicy: sourceThread?.approvalPolicy,
      sandboxMode: sourceThread?.sandboxMode,
      forkedFromThreadId: sourceThread?.id,
      forkedFromTitle: sourceThread?.title,
      forkedAt: now,
      forkedFromMessageCount: clonedItems.filter((item) => item.kind === 'user_message').length,
      forkedFromTurnCount: clonedTurns.length,
      ...(sourceThread?.todos ? { todos: cloneTodoListForThread(sourceThread.todos, threadId, now) } : {}),
      createdAt: now
    })
    const resumed: ThreadRecord = {
      ...record,
      updatedAt: now,
      turns: clonedTurns
    }
    for (const item of clonedItems) {
      await this.sessionStore.appendItem(resumed.id, item)
    }
    await this.threadStore.upsert(resumed)
    await this.sessionStore.upsertSession(toSessionSnapshot(resumed, now))
    await this.events.record({
      kind: 'thread_created',
      threadId: resumed.id,
      title: resumed.title
    })
    return { thread: resumed, sessionId, messageCount: clonedItems.length }
  }

  toSummary(thread: ThreadRecord): ThreadSummary {
    return toThreadSummary(thread)
  }
}

function cloneTurnForThread(turn: Turn, threadId: string, now: string): Turn {
  const items = repairModelHistoryItems(turn.items.map((item) => cloneItemForThread(item, threadId, now)))
  const attachmentIds = turn.attachmentIds.length > 0
    ? turn.attachmentIds
    : attachmentIdsFromItems(items)
  return {
    ...turn,
    threadId,
    status: turn.status === 'queued' || turn.status === 'running' ? 'completed' : turn.status,
    finishedAt: turn.finishedAt ?? now,
    attachmentIds,
    items
  }
}

function normalizeTodoItems(input: {
  rawItems: SetThreadTodosRequest['todos']
  existingItems: readonly ThreadTodoItem[]
  now: string
  ids: IdGenerator
}): ThreadTodoItem[] {
  const existingById = new Map(input.existingItems.map((item) => [item.id, item]))
  const usedIds = new Set<string>()
  let inProgressSeen = false
  return input.rawItems.map((raw) => {
    const content = normalizeTodoContent(raw.content)
    if (!content) throw new Error('todo content is required')
    const status = normalizeTodoStatus(raw.status)
    if (status === 'in_progress') {
      if (inProgressSeen) throw new Error('at most one todo can be in_progress')
      inProgressSeen = true
    }
    const source = raw.source ? normalizeTodoSource(raw.source) : undefined
    const requestedId = raw.id?.trim()
    const existing =
      (requestedId ? existingById.get(requestedId) : undefined) ??
      findExistingTodoForRaw(input.existingItems, usedIds, { content, source })
    const id = uniqueTodoId(requestedId || existing?.id || input.ids.next('todo'), usedIds, input.ids)
    const changed =
      !existing ||
      existing.content !== content ||
      existing.status !== status ||
      !sameTodoSource(existing.source, source)
    usedIds.add(id)
    return {
      id,
      content,
      status,
      ...(source ? { source } : {}),
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: changed ? input.now : existing.updatedAt
    }
  })
}

function normalizeTodoStatus(status: ThreadTodoStatus): ThreadTodoStatus {
  if (status === 'pending' || status === 'in_progress' || status === 'completed') return status
  throw new Error(`unsupported todo status: ${String(status)}`)
}

function normalizeTodoSource(source: ThreadTodoSource): ThreadTodoSource {
  if (source.kind !== 'plan') throw new Error(`unsupported todo source: ${String(source.kind)}`)
  const relativePath = normalizePlanRelativePath(source.relativePath)
  if (!isGuiPlanRelativePath(relativePath)) {
    throw new Error(`invalid GUI plan relative path: ${source.relativePath}`)
  }
  return {
    kind: 'plan',
    planId: source.planId,
    relativePath,
    ordinal: source.ordinal,
    contentHash: source.contentHash
  }
}

function findExistingTodoForRaw(
  existingItems: readonly ThreadTodoItem[],
  usedIds: ReadonlySet<string>,
  raw: { content: string; source?: ThreadTodoSource }
): ThreadTodoItem | undefined {
  const candidates = existingItems.filter((item) => !usedIds.has(item.id))
  if (raw.source) {
    return (
      candidates.find((item) => item.source && sameTodoSource(item.source, raw.source)) ??
      candidates.find((item) =>
        item.source?.kind === 'plan' &&
        item.source.planId === raw.source?.planId &&
        item.source.relativePath === raw.source.relativePath &&
        item.source.contentHash === raw.source.contentHash
      ) ??
      candidates.find((item) =>
        item.source?.kind === 'plan' &&
        item.source.planId === raw.source?.planId &&
        item.source.relativePath === raw.source.relativePath &&
        item.source.ordinal === raw.source.ordinal
      )
    )
  }
  const hash = todoContentHash(raw.content)
  return candidates.find((item) => !item.source && todoContentHash(item.content) === hash)
}

function sameTodoSource(
  first: ThreadTodoSource | undefined,
  second: ThreadTodoSource | undefined
): boolean {
  if (!first || !second) return !first && !second
  return (
    first.kind === second.kind &&
    first.planId === second.planId &&
    first.relativePath === second.relativePath &&
    first.ordinal === second.ordinal &&
    first.contentHash === second.contentHash
  )
}

function uniqueTodoId(requested: string, usedIds: Set<string>, ids: IdGenerator): string {
  let candidate = requested.trim()
  while (!candidate || usedIds.has(candidate)) {
    candidate = ids.next('todo')
  }
  return candidate
}

function cloneTodoListForThread(todos: ThreadTodoList, threadId: string, now: string): ThreadTodoList {
  return {
    threadId,
    items: todos.items.map((item) => ({ ...item })),
    updatedAt: now
  }
}

function resolveWorkspaceRelativePath(workspace: string, relativePath: string): string {
  const root = resolve(workspace)
  const target = resolve(root, relativePath)
  const fromRoot = relative(root, target)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`plan path escapes workspace: ${relativePath}`)
  }
  return target
}

/**
 * Clone a turn into a new thread for fork/side spawn.
 *
 * For `relation: 'side'`, an in-flight parent turn (queued/running) is
 * copied as `aborted` with only its user prompt kept: unfinished
 * assistant/tool items are dropped so the side thread does not inherit
 * half-streamed tool calls or reasoning. Completed parent turns are
 * copied as-is (still re-routed through item clone for new threadId).
 *
 * For `relation: 'fork'`, behavior is unchanged from
 * `cloneTurnForThread` (in-flight is finalized as `completed`).
 */
function cloneTurnForFork(
  turn: Turn,
  threadId: string,
  now: string,
  options: { relation: ThreadRelation }
): Turn {
  const isInFlight = turn.status === 'queued' || turn.status === 'running'
  if (options.relation === 'side' && isInFlight) {
    const userPromptItem = turn.items.find((item) => item.kind === 'user_message')
    const userPromptItemCloned = userPromptItem
      ? cloneItemForThread(userPromptItem, threadId, now)
      : undefined
    return {
      ...turn,
      threadId,
      status: 'aborted',
      finishedAt: turn.finishedAt ?? now,
      attachmentIds: turn.attachmentIds.length > 0
        ? turn.attachmentIds
        : attachmentIdsFromItems(userPromptItemCloned ? [userPromptItemCloned] : []),
      // Keep the user prompt; drop everything else to avoid carrying
      // half-streamed assistant/tool state into the side thread.
      items: userPromptItemCloned ? [userPromptItemCloned] : []
    }
  }
  return cloneTurnForThread(turn, threadId, now)
}

function cloneItemForThread(item: TurnItem, threadId: string, now: string): TurnItem {
  const cloned = {
    ...item,
    threadId
  } as TurnItem
  if (cloned.status === 'pending' || cloned.status === 'running') {
    if (cloned.kind === 'approval') {
      return { ...cloned, status: 'expired', finishedAt: cloned.finishedAt ?? now }
    }
    if (cloned.kind === 'user_input') {
      return { ...cloned, status: 'cancelled', finishedAt: cloned.finishedAt ?? now }
    }
    return { ...cloned, status: 'completed', finishedAt: cloned.finishedAt ?? now } as TurnItem
  }
  return cloned
}

function matchesThreadSearch(thread: ThreadSummary, query: string): boolean {
  return [
    thread.id,
    thread.title,
    thread.workspace,
    thread.model,
    thread.mode,
    thread.forkedFromTitle,
    thread.forkedFromThreadId
  ].some((value) => value?.toLowerCase().includes(query))
}

function rebuildTurnsFromItems(input: {
  items: TurnItem[]
  threadId: string
  fallbackTurnId: string
  fallbackPrompt: string
  now: string
}): Turn[] {
  const byTurn = new Map<string, TurnItem[]>()
  for (const item of input.items) {
    const turnId = item.turnId || input.fallbackTurnId
    byTurn.set(turnId, [...(byTurn.get(turnId) ?? []), { ...item, threadId: input.threadId } as TurnItem])
  }
  if (byTurn.size === 0) {
    return [{
      id: input.fallbackTurnId,
      threadId: input.threadId,
      status: 'completed',
      prompt: input.fallbackPrompt,
      steering: [],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      createdAt: input.now,
      finishedAt: input.now,
      items: []
    }]
  }
  return [...byTurn.entries()].map(([turnId, items]) => {
    const prompt =
      items.find((item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message')
        ?.text ?? input.fallbackPrompt
    return {
      id: turnId,
      threadId: input.threadId,
      status: 'completed',
      prompt,
      steering: [],
      attachmentIds: attachmentIdsFromItems(items),
      activeSkillIds: [],
      injectedMemoryIds: [],
      createdAt: items[0]?.createdAt ?? input.now,
      finishedAt: input.now,
      items
    }
  })
}

function attachmentIdsFromItems(items: TurnItem[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'user_message') continue
    for (const id of item.attachmentIds ?? []) {
      const trimmed = id.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids]
}

function toSessionSnapshot(thread: ThreadRecord, now: string): AgentSession {
  const firstTurn = thread.turns[0]
  return {
    threadId: thread.id,
    turnId: firstTurn?.id ?? '',
    startedAt: firstTurn?.createdAt ?? thread.createdAt,
    updatedAt: now,
    items: thread.turns.flatMap((turn) => turn.items),
    events: [],
    closed: true
  }
}
