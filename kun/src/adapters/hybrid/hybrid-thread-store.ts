import { mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type {
  ThreadGoal,
  ThreadMode,
  ThreadRecord,
  ThreadRelation,
  ThreadStatus,
  ThreadTodoList,
  ThreadSummary
} from '../../contracts/threads.js'
import { ThreadSchema } from '../../contracts/threads.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { Turn } from '../../contracts/turns.js'
import type { ApprovalPolicy, SandboxMode } from '../../contracts/policy.js'
import type { ThreadStore, ThreadStoreListOptions } from '../../ports/thread-store.js'
import { toThreadSummary } from '../../domain/thread.js'
import { readJsonl } from '../file/file-thread-store.js'

type ThreadMetadataLine = {
  kind: 'thread_metadata'
  version: 1
  timestamp: string
  thread: ThreadRecord
}

type ThreadRow = {
  id: string
  title: string
  workspace: string
  model: string
  mode: ThreadMode
  status: ThreadStatus
  approval_policy: ApprovalPolicy
  sandbox_mode: SandboxMode
  cost_budget_usd: number | null
  cost_budget_warning_sent: number | null
  relation: ThreadRelation
  parent_thread_id: string | null
  forked_from_thread_id: string | null
  forked_from_title: string | null
  forked_at: string | null
  forked_from_message_count: number | null
  forked_from_turn_count: number | null
  goal_json: string | null
  todos_json: string | null
  created_at: string
  updated_at: string
  created_at_ms: number
  updated_at_ms: number
  preview: string | null
  message_count: number
  event_seq_high_water: number
  metadata_path: string
  messages_path: string
  events_path: string
  search_text: string
}

type ThreadIndexRecord = {
  thread: ThreadRecord
  messageCount: number
  eventSeqHighWater: number
  preview: string
}

/**
 * Hybrid store inspired by Codex: JSONL files are canonical and SQLite
 * is a rebuildable index. SQLite writes always happen after metadata
 * JSONL has been appended.
 */
export class HybridThreadStore implements ThreadStore {
  private readonly dataDir: string
  private readonly sqlitePath: string
  private readonly nowIso: () => string
  private readonly readyPromise: Promise<void>
  private readonly metadataQueues = new Map<string, Promise<void>>()
  private db: BetterSqliteDatabase | null = null

  constructor(options: { dataDir: string; sqlitePath?: string; nowIso?: () => string }) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.sqlitePath = resolve(options.sqlitePath ?? join(options.dataDir, 'index.sqlite3'))
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.readyPromise = this.initialize()
  }

  async ready(): Promise<void> {
    await this.readyPromise
  }

  close(): void {
    try {
      this.db?.close()
    } finally {
      this.db = null
    }
  }

  async list(options: ThreadStoreListOptions = {}): Promise<ThreadSummary[]> {
    await this.ready()
    if (this.db) {
      try {
        const rows = this.queryThreadRows(options)
        const summaries: ThreadSummary[] = []
        for (const row of rows) {
          if (await this.rowHasReadableJsonl(row)) {
            summaries.push(summaryFromRow(row))
          } else {
            this.deleteIndexRow(row.id)
          }
        }
        return summaries
      } catch (error) {
        warnSqlite('list', error)
      }
    }
    return filterThreadSummaries(await this.listFromFilesystem(), options)
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    await this.ready()
    if (this.db) {
      const row = this.findRow(threadId)
      if (row && !(await this.rowHasReadableJsonl(row))) {
        this.deleteIndexRow(threadId)
      }
    }

    const thread = await this.readThreadFromDisk(threadId)
    if (thread && this.db) {
      this.upsertIndexBestEffort(await this.indexRecordForThread(thread))
    }
    return thread
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    await this.ready()
    await this.appendMetadata(thread)
    if (this.db) {
      this.upsertIndexBestEffort(await this.indexRecordForThread(thread))
    }
    return thread
  }

  async delete(threadId: string): Promise<boolean> {
    await this.ready()
    const dir = this.threadDir(threadId)
    const existed = await pathExists(dir)
    if (!existed) {
      this.deleteIndexRow(threadId)
      return false
    }
    await rm(dir, { recursive: true, force: true })
    this.deleteIndexRow(threadId)
    return true
  }

  async noteEventSeq(threadId: string, seq: number): Promise<void> {
    await this.ready()
    if (!this.db) return
    try {
      this.db
        .prepare(`
          UPDATE threads
          SET event_seq_high_water = CASE
            WHEN event_seq_high_water > @seq THEN event_seq_high_water
            ELSE @seq
          END
          WHERE id = @id
        `)
        .run({ id: threadId, seq })
    } catch (error) {
      warnSqlite('note event seq', error)
    }
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await mkdir(dirname(this.sqlitePath), { recursive: true })
    try {
      const sqlite = await import('better-sqlite3')
      const Database = sqlite.default
      this.db = new Database(this.sqlitePath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('foreign_keys = ON')
      this.migrate()
      await this.backfill()
    } catch (error) {
      warnSqlite('initialize', error)
      try {
        this.db?.close()
      } catch {
        // Ignore close errors while falling back to JSONL scanning.
      }
      this.db = null
    }
  }

  private migrate(): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace TEXT NOT NULL,
        model TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        cost_budget_usd REAL,
        cost_budget_warning_sent INTEGER,
        relation TEXT NOT NULL,
        parent_thread_id TEXT,
        forked_from_thread_id TEXT,
        forked_from_title TEXT,
        forked_at TEXT,
        forked_from_message_count INTEGER,
        forked_from_turn_count INTEGER,
        goal_json TEXT,
        todos_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        preview TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        event_seq_high_water INTEGER NOT NULL DEFAULT 0,
        metadata_path TEXT NOT NULL,
        messages_path TEXT NOT NULL,
        events_path TEXT NOT NULL,
        search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS threads_updated_idx
        ON threads(updated_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_workspace_updated_idx
        ON threads(workspace, updated_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_status_updated_idx
        ON threads(status, updated_at_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_relation_updated_idx
        ON threads(relation, updated_at_ms DESC, id DESC);
    `)
    addColumnIfMissing(this.db, 'threads', 'todos_json TEXT')
  }

  private async backfill(): Promise<void> {
    if (!this.db) return
    const discovered = new Set<string>()
    for (const threadId of await this.threadIdsFromFilesystem()) {
      const thread = await this.readThreadFromDisk(threadId)
      if (!thread) continue
      discovered.add(thread.id)
      this.upsertIndexBestEffort(await this.indexRecordForThread(thread))
    }

    try {
      const rows = this.db.prepare('SELECT id FROM threads').all() as Array<{ id: string }>
      for (const row of rows) {
        if (discovered.has(row.id)) continue
        if (!(await pathExists(this.threadDir(row.id)))) {
          this.deleteIndexRow(row.id)
        }
      }
    } catch (error) {
      warnSqlite('backfill cleanup', error)
    }
  }

  private queryThreadRows(options: ThreadStoreListOptions): ThreadRow[] {
    if (!this.db) return []
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (options.archivedOnly) {
      where.push('status = @archivedStatus')
      params.archivedStatus = 'archived'
    } else if (!options.includeArchived) {
      where.push("status NOT IN ('archived', 'deleted')")
    }
    if (!options.includeSide) {
      where.push("relation != 'side'")
    }
    const search = options.search?.trim().toLowerCase()
    if (search) {
      where.push("search_text LIKE @search ESCAPE '\\'")
      params.search = `%${escapeLike(search)}%`
    }
    const limit = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : undefined
    if (limit !== undefined) {
      params.limit = limit
    }
    const sql = `
      SELECT * FROM threads
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at_ms DESC, id DESC
      ${limit !== undefined ? 'LIMIT @limit' : ''}
    `
    return this.db.prepare(sql).all(params) as ThreadRow[]
  }

  private findRow(threadId: string): ThreadRow | null {
    if (!this.db) return null
    try {
      return (this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as ThreadRow | undefined) ?? null
    } catch (error) {
      warnSqlite('find row', error)
      return null
    }
  }

  private upsertIndexBestEffort(record: ThreadIndexRecord): void {
    if (!this.db) return
    try {
      const row = rowFromIndexRecord(record, {
        metadataPath: this.metadataPath(record.thread.id),
        messagesPath: this.messagesPath(record.thread.id),
        eventsPath: this.eventsPath(record.thread.id)
      })
      this.db
        .prepare(`
          INSERT INTO threads (
            id, title, workspace, model, mode, status, approval_policy, sandbox_mode,
            cost_budget_usd, cost_budget_warning_sent, relation, parent_thread_id,
            forked_from_thread_id, forked_from_title, forked_at, forked_from_message_count,
            forked_from_turn_count, goal_json, todos_json, created_at, updated_at, created_at_ms,
            updated_at_ms, preview, message_count, event_seq_high_water, metadata_path,
            messages_path, events_path, search_text
          )
          VALUES (
            @id, @title, @workspace, @model, @mode, @status, @approval_policy, @sandbox_mode,
            @cost_budget_usd, @cost_budget_warning_sent, @relation, @parent_thread_id,
            @forked_from_thread_id, @forked_from_title, @forked_at, @forked_from_message_count,
            @forked_from_turn_count, @goal_json, @todos_json, @created_at, @updated_at, @created_at_ms,
            @updated_at_ms, @preview, @message_count, @event_seq_high_water, @metadata_path,
            @messages_path, @events_path, @search_text
          )
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            workspace = excluded.workspace,
            model = excluded.model,
            mode = excluded.mode,
            status = excluded.status,
            approval_policy = excluded.approval_policy,
            sandbox_mode = excluded.sandbox_mode,
            cost_budget_usd = excluded.cost_budget_usd,
            cost_budget_warning_sent = excluded.cost_budget_warning_sent,
            relation = excluded.relation,
            parent_thread_id = excluded.parent_thread_id,
            forked_from_thread_id = excluded.forked_from_thread_id,
            forked_from_title = excluded.forked_from_title,
            forked_at = excluded.forked_at,
            forked_from_message_count = excluded.forked_from_message_count,
            forked_from_turn_count = excluded.forked_from_turn_count,
            goal_json = excluded.goal_json,
            todos_json = excluded.todos_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            created_at_ms = excluded.created_at_ms,
            updated_at_ms = excluded.updated_at_ms,
            preview = excluded.preview,
            message_count = excluded.message_count,
            event_seq_high_water = CASE
              WHEN threads.event_seq_high_water > excluded.event_seq_high_water
                THEN threads.event_seq_high_water
              ELSE excluded.event_seq_high_water
            END,
            metadata_path = excluded.metadata_path,
            messages_path = excluded.messages_path,
            events_path = excluded.events_path,
            search_text = excluded.search_text
        `)
        .run(row)
    } catch (error) {
      warnSqlite('upsert index', error)
    }
  }

  private deleteIndexRow(threadId: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId)
    } catch (error) {
      warnSqlite('delete index row', error)
    }
  }

  private async appendMetadata(thread: ThreadRecord): Promise<void> {
    const previous = this.metadataQueues.get(thread.id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      await mkdir(this.threadDir(thread.id), { recursive: true })
      const line: ThreadMetadataLine = {
        kind: 'thread_metadata',
        version: 1,
        timestamp: this.nowIso(),
        thread: stripThreadItemBodies(thread)
      }
      await appendJsonlLine(this.metadataPath(thread.id), line)
    })
    const guard = run.then(() => undefined, () => undefined)
    this.metadataQueues.set(thread.id, guard)
    try {
      await run
    } finally {
      if (this.metadataQueues.get(thread.id) === guard) {
        this.metadataQueues.delete(thread.id)
      }
    }
  }

  private async indexRecordForThread(thread: ThreadRecord): Promise<ThreadIndexRecord> {
    const items = await this.loadItems(thread.id)
    const itemSource = items.length > 0 ? items : thread.turns.flatMap((turn) => turn.items)
    const eventSeqHighWater = await this.highestSeq(thread.id)
    return {
      thread,
      messageCount: itemSource.length,
      eventSeqHighWater,
      preview: previewFromItems(itemSource)
    }
  }

  private async readThreadFromDisk(threadId: string): Promise<ThreadRecord | null> {
    const metadata = await this.readLatestMetadata(threadId)
    const legacy = metadata ? null : await this.readLegacyThread(threadId)
    const source = metadata ?? legacy
    if (!source) return null
    const items = await this.loadItems(threadId)
    return hydrateThreadItems(source, items, {
      preserveExistingItemsWhenNoFileItems: Boolean(legacy)
    })
  }

  private async readLatestMetadata(threadId: string): Promise<ThreadRecord | null> {
    const entries = await readJsonl<ThreadMetadataLine>(this.metadataPath(threadId))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
      const parsed = ThreadSchema.safeParse(entry.thread)
      if (parsed.success) {
        return normalizeThreadMetadata(parsed.data, entries.slice(0, index + 1))
      }
    }
    return null
  }

  private async readLegacyThread(threadId: string): Promise<ThreadRecord | null> {
    try {
      const raw = await readFile(this.legacyThreadPath(threadId), 'utf-8')
      const parsed = ThreadSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private async loadItems(threadId: string): Promise<TurnItem[]> {
    const raw = await readJsonl<TurnItem>(this.messagesPath(threadId))
    const latestById = new Map<string, TurnItem>()
    for (const item of raw) {
      latestById.set(item.id, item)
    }
    const seen = new Set<string>()
    const ordered: TurnItem[] = []
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const item = raw[index]
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      ordered.unshift(latestById.get(item.id)!)
    }
    return ordered
  }

  private async highestSeq(threadId: string): Promise<number> {
    const events = await readJsonl<RuntimeEvent>(this.eventsPath(threadId))
    return events.reduce((max, event) => Math.max(max, event.seq), 0)
  }

  private async listFromFilesystem(): Promise<ThreadSummary[]> {
    const summaries: ThreadSummary[] = []
    for (const threadId of await this.threadIdsFromFilesystem()) {
      const thread = await this.readThreadFromDisk(threadId)
      if (thread) summaries.push(toThreadSummary(thread))
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async threadIdsFromFilesystem(): Promise<string[]> {
    try {
      const entries = await readdir(this.dataDir, { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  private async rowHasReadableJsonl(row: ThreadRow): Promise<boolean> {
    if (row.metadata_path !== this.metadataPath(row.id)) return false
    if (row.messages_path !== this.messagesPath(row.id)) return false
    if (row.events_path !== this.eventsPath(row.id)) return false
    if (!(await pathExists(this.threadDir(row.id)))) return false
    return (await pathExists(this.metadataPath(row.id))) || (await pathExists(this.legacyThreadPath(row.id)))
  }

  private threadDir(threadId: string): string {
    return join(this.dataDir, threadId)
  }

  private metadataPath(threadId: string): string {
    return join(this.threadDir(threadId), 'metadata.jsonl')
  }

  private legacyThreadPath(threadId: string): string {
    return join(this.threadDir(threadId), 'thread.json')
  }

  private messagesPath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages.jsonl')
  }

  private eventsPath(threadId: string): string {
    return join(this.threadDir(threadId), 'events.jsonl')
  }
}

function stripThreadItemBodies(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    turns: thread.turns.map((turn) => ({ ...turn, prompt: '', items: [] }))
  }
}

function hydrateThreadItems(
  thread: ThreadRecord,
  items: TurnItem[],
  options: { preserveExistingItemsWhenNoFileItems: boolean }
): ThreadRecord {
  if (items.length === 0) {
    return options.preserveExistingItemsWhenNoFileItems ? thread : stripThreadItemBodies(thread)
  }
  const itemsByTurn = new Map<string, TurnItem[]>()
  for (const item of items) {
    const list = itemsByTurn.get(item.turnId) ?? []
    list.push(item)
    itemsByTurn.set(item.turnId, list)
  }

  const knownTurnIds = new Set(thread.turns.map((turn) => turn.id))
  const turns = thread.turns.map((turn): Turn => {
    const turnItems = itemsByTurn.get(turn.id) ?? []
    const attachmentIds = turn.attachmentIds.length > 0
      ? turn.attachmentIds
      : attachmentIdsFromItems(turnItems)
    return {
      ...turn,
      prompt: promptFromItems(turnItems) || turn.prompt,
      attachmentIds,
      items: turnItems
    }
  })
  for (const [turnId, turnItems] of itemsByTurn) {
    if (knownTurnIds.has(turnId)) continue
    turns.push(turnFromItems(thread.id, turnId, turnItems, thread.updatedAt))
  }
  turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { ...thread, turns }
}

function normalizeThreadMetadata(thread: ThreadRecord, entries: ThreadMetadataLine[]): ThreadRecord {
  const recovery = collectTurnMetadata(entries, thread.id)
  const mergedById = new Map<string, Turn>()
  const order: string[] = []
  for (const turn of thread.turns) {
    if (!mergedById.has(turn.id)) order.push(turn.id)
    const existing = mergedById.get(turn.id)
    mergedById.set(turn.id, existing ? mergeTurnMetadata(existing, turn) : turn)
  }
  const turns = order.map((turnId) => applyRecoveredTurnMetadata(mergedById.get(turnId)!, recovery.get(turnId)))
  return turns.length === thread.turns.length && turns.every((turn, index) => turn === thread.turns[index])
    ? thread
    : { ...thread, turns }
}

type RecoveredTurnMetadata = {
  attachmentIds: string[]
  model?: string
  mode?: Turn['mode']
  guiPlan?: Turn['guiPlan']
}

function collectTurnMetadata(entries: ThreadMetadataLine[], threadId: string): Map<string, RecoveredTurnMetadata> {
  const recovered = new Map<string, RecoveredTurnMetadata>()
  for (const entry of entries) {
    if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
    const parsed = ThreadSchema.safeParse(entry.thread)
    if (!parsed.success) continue
    for (const turn of parsed.data.turns) {
      const current = recovered.get(turn.id) ?? { attachmentIds: [] }
      recovered.set(turn.id, {
        attachmentIds: mergeStringArrays(current.attachmentIds, turn.attachmentIds),
        ...(turn.model ? { model: turn.model } : current.model ? { model: current.model } : {}),
        ...(turn.mode ? { mode: turn.mode } : current.mode ? { mode: current.mode } : {}),
        ...(turn.guiPlan ? { guiPlan: turn.guiPlan } : current.guiPlan ? { guiPlan: current.guiPlan } : {})
      })
    }
  }
  return recovered
}

function mergeTurnMetadata(previous: Turn, next: Turn): Turn {
  return {
    ...previous,
    ...next,
    prompt: next.prompt || previous.prompt,
    attachmentIds: mergeStringArrays(previous.attachmentIds, next.attachmentIds),
    activeSkillIds: mergeStringArrays(previous.activeSkillIds, next.activeSkillIds),
    injectedMemoryIds: mergeStringArrays(previous.injectedMemoryIds, next.injectedMemoryIds),
    items: mergeTurnItems(previous.items, next.items)
  }
}

function applyRecoveredTurnMetadata(turn: Turn, recovered: RecoveredTurnMetadata | undefined): Turn {
  if (!recovered) return turn
  const attachmentIds = turn.attachmentIds.length > 0 ? turn.attachmentIds : recovered.attachmentIds
  return {
    ...turn,
    attachmentIds,
    ...(turn.model || !recovered.model ? {} : { model: recovered.model }),
    ...(turn.mode || !recovered.mode ? {} : { mode: recovered.mode }),
    ...(turn.guiPlan || !recovered.guiPlan ? {} : { guiPlan: recovered.guiPlan })
  }
}

function mergeTurnItems(previous: TurnItem[], next: TurnItem[]): TurnItem[] {
  if (previous.length === 0) return next
  if (next.length === 0) return previous
  const byId = new Map<string, TurnItem>()
  for (const item of previous) byId.set(item.id, item)
  for (const item of next) byId.set(item.id, item)
  return [...byId.values()]
}

function turnFromItems(threadId: string, turnId: string, items: TurnItem[], fallbackTime: string): Turn {
  const prompt = promptFromItems(items) || `Turn ${turnId}`
  const createdAt = items[0]?.createdAt ?? fallbackTime
  const hasOpenItem = items.some((item) => item.status === 'pending' || item.status === 'running')
  const hasFailedItem = items.some((item) => item.status === 'failed' || item.status === 'aborted')
  return {
    id: turnId,
    threadId,
    status: hasOpenItem ? 'running' : hasFailedItem ? 'failed' : 'completed',
    prompt,
    steering: [],
    attachmentIds: attachmentIdsFromItems(items),
    activeSkillIds: [],
    injectedMemoryIds: [],
    createdAt,
    finishedAt: hasOpenItem ? undefined : items[items.length - 1]?.finishedAt ?? fallbackTime,
    items
  }
}

function promptFromItems(items: TurnItem[]): string {
  return items.find((item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message')
    ?.text ?? ''
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

function mergeStringArrays(first: readonly string[], second: readonly string[]): string[] {
  const values = new Set<string>()
  for (const value of [...first, ...second]) {
    const trimmed = value.trim()
    if (trimmed) values.add(trimmed)
  }
  return [...values]
}

function rowFromIndexRecord(
  record: ThreadIndexRecord,
  paths: { metadataPath: string; messagesPath: string; eventsPath: string }
): ThreadRow {
  const thread = record.thread
  return {
    id: thread.id,
    title: thread.title,
    workspace: thread.workspace,
    model: thread.model,
    mode: thread.mode,
    status: thread.status,
    approval_policy: thread.approvalPolicy,
    sandbox_mode: thread.sandboxMode,
    cost_budget_usd: thread.costBudgetUsd ?? null,
    cost_budget_warning_sent: thread.costBudgetWarningSent === undefined
      ? null
      : thread.costBudgetWarningSent
        ? 1
        : 0,
    relation: thread.relation ?? 'primary',
    parent_thread_id: thread.parentThreadId ?? null,
    forked_from_thread_id: thread.forkedFromThreadId ?? null,
    forked_from_title: thread.forkedFromTitle ?? null,
    forked_at: thread.forkedAt ?? null,
    forked_from_message_count: thread.forkedFromMessageCount ?? null,
    forked_from_turn_count: thread.forkedFromTurnCount ?? null,
    goal_json: thread.goal ? JSON.stringify(thread.goal) : null,
    todos_json: thread.todos ? JSON.stringify(thread.todos) : null,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    created_at_ms: isoToMillis(thread.createdAt),
    updated_at_ms: isoToMillis(thread.updatedAt),
    preview: record.preview || null,
    message_count: record.messageCount,
    event_seq_high_water: record.eventSeqHighWater,
    metadata_path: paths.metadataPath,
    messages_path: paths.messagesPath,
    events_path: paths.eventsPath,
    search_text: searchTextForThread(thread, record.preview)
  }
}

function summaryFromRow(row: ThreadRow): ThreadSummary {
  const goal = parseGoal(row.goal_json)
  const todos = parseTodos(row.todos_json)
  return {
    id: row.id,
    title: row.title,
    workspace: row.workspace,
    model: row.model,
    mode: row.mode,
    status: row.status,
    ...(row.cost_budget_usd !== null ? { costBudgetUsd: row.cost_budget_usd } : {}),
    ...(row.cost_budget_warning_sent !== null ? { costBudgetWarningSent: Boolean(row.cost_budget_warning_sent) } : {}),
    relation: row.relation,
    ...(row.parent_thread_id ? { parentThreadId: row.parent_thread_id } : {}),
    ...(row.forked_from_thread_id ? { forkedFromThreadId: row.forked_from_thread_id } : {}),
    ...(row.forked_from_title ? { forkedFromTitle: row.forked_from_title } : {}),
    ...(row.forked_at ? { forkedAt: row.forked_at } : {}),
    ...(row.forked_from_message_count !== null ? { forkedFromMessageCount: row.forked_from_message_count } : {}),
    ...(row.forked_from_turn_count !== null ? { forkedFromTurnCount: row.forked_from_turn_count } : {}),
    ...(goal ? { goal } : {}),
    ...(todos ? { todos } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseGoal(raw: string | null): ThreadGoal | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ThreadGoal
  } catch {
    return null
  }
}

function parseTodos(raw: string | null): ThreadTodoList | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ThreadTodoList
  } catch {
    return null
  }
}

function filterThreadSummaries(
  summaries: ThreadSummary[],
  options: ThreadStoreListOptions
): ThreadSummary[] {
  const query = options.search?.trim().toLowerCase()
  let out = summaries
  if (options.archivedOnly) {
    out = out.filter((thread) => thread.status === 'archived')
  } else if (!options.includeArchived) {
    out = out.filter((thread) => thread.status !== 'archived' && thread.status !== 'deleted')
  }
  if (!options.includeSide) {
    out = out.filter((thread) => (thread.relation ?? 'primary') !== 'side')
  }
  if (query) {
    out = out.filter((thread) => searchTextForSummary(thread).includes(query))
  }
  return typeof options.limit === 'number' ? out.slice(0, options.limit) : out
}

function searchTextForThread(thread: ThreadRecord, _preview: string): string {
  return [
    thread.id,
    thread.title,
    thread.workspace,
    thread.model,
    thread.mode,
    thread.forkedFromTitle,
    thread.forkedFromThreadId,
    ...(thread.todos?.items.map((item) => item.content) ?? [])
  ].filter(Boolean).join('\n').toLowerCase()
}

function searchTextForSummary(thread: ThreadSummary): string {
  return [
    thread.id,
    thread.title,
    thread.workspace,
    thread.model,
    thread.mode,
    thread.forkedFromTitle,
    thread.forkedFromThreadId,
    ...(thread.todos?.items.map((item) => item.content) ?? [])
  ].filter(Boolean).join('\n').toLowerCase()
}

function previewFromItems(items: TurnItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (item.kind === 'user_message' || item.kind === 'assistant_text') {
      return item.text.slice(0, 500)
    }
    if (item.kind === 'error') return item.message.slice(0, 500)
    if (item.kind === 'tool_call') return (item.summary ?? item.toolName).slice(0, 500)
  }
  return ''
}

function isoToMillis(value: string): number {
  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : 0
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`)
}

function addColumnIfMissing(db: BetterSqliteDatabase, table: string, columnSql: string): void {
  const column = columnSql.trim().split(/\s+/)[0]
  if (!column) return
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (rows.some((row) => row.name === column)) return
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`)
  } catch (error) {
    warnSqlite(`add column ${column}`, error)
  }
}

async function appendJsonlLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function warnSqlite(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] hybrid sqlite ${action} failed; using JSONL fallback: ${message}`)
}
