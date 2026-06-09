import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { SessionStore } from '../../ports/session-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { AgentSession } from '../../domain/session.js'
import { readJsonl } from './file-thread-store.js'
import { atomicWriteFile } from './atomic-write.js'

const DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_USAGE_EVENT_RETENTION_DAYS = 365
const MS_PER_DAY = 86_400_000

/**
 * File-backed session store. Appends events and items to per-thread
 * JSONL files and keeps the canonical session snapshot in a small
 * JSON file. Replay reads the JSONL files end-to-end.
 */
export class FileSessionStore implements SessionStore {
  private readonly dataDir: string
  private readonly usageEventCompaction: {
    maxBytes: number
    retentionDays: number
    nowIso: () => string
  }

  constructor(options: {
    dataDir: string
    usageEventCompaction?: {
      maxBytes?: number
      retentionDays?: number
      nowIso?: () => string
    }
  }) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.usageEventCompaction = {
      maxBytes: Math.max(
        1,
        Math.floor(options.usageEventCompaction?.maxBytes ?? DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES)
      ),
      retentionDays: Math.max(
        1,
        Math.floor(options.usageEventCompaction?.retentionDays ?? DEFAULT_USAGE_EVENT_RETENTION_DAYS)
      ),
      nowIso: options.usageEventCompaction?.nowIso ?? (() => new Date().toISOString())
    }
  }

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    await this.ensureDir(this.threadDir(threadId))
    const path = this.eventsPath(threadId)
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8')
    if (event.kind === 'usage') {
      await this.compactUsageEventsIfLarge(threadId).catch((error) => {
        warnUsageCompaction(threadId, error)
      })
    }
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    await this.ensureDir(this.threadDir(threadId))
    const path = this.messagesPath(threadId)
    await appendFile(path, `${JSON.stringify(item)}\n`, 'utf-8')
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    await this.ensureDir(this.threadDir(threadId))
    const contents = items.map((item) => JSON.stringify(item)).join('\n')
    await this.atomicWrite(this.messagesPath(threadId), contents ? `${contents}\n` : '')
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    const items = await this.loadItems(threadId)
    const current = items.find((item) => item.id === itemId)
    if (!current) return null
    const updated = { ...current, ...patch } as TurnItem
    await this.ensureDir(this.threadDir(threadId))
    await appendFile(this.messagesPath(threadId), `${JSON.stringify(updated)}\n`, 'utf-8')
    return updated
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    const all = await readJsonl<RuntimeEvent>(this.eventsPath(threadId))
    return all
      .filter((event) => event.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq)
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    const raw = await readJsonl<TurnItem>(this.messagesPath(threadId))
    const latestById = new Map<string, TurnItem>()
    for (const item of raw) {
      latestById.set(item.id, item)
    }
    const seen = new Set<string>()
    const ordered: TurnItem[] = []
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const item = raw[index]!
      if (seen.has(item.id)) continue
      seen.add(item.id)
      ordered.unshift(latestById.get(item.id)!)
    }
    return ordered
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    try {
      const raw = await readFile(this.sessionPath(threadId), 'utf-8')
      return JSON.parse(raw) as AgentSession
    } catch {
      return null
    }
  }

  async upsertSession(session: AgentSession): Promise<void> {
    await this.ensureDir(this.threadDir(session.threadId))
    await this.atomicWrite(this.sessionPath(session.threadId), JSON.stringify(session))
  }

  async highestSeq(threadId: string): Promise<number> {
    const events = await readJsonl<RuntimeEvent>(this.eventsPath(threadId))
    return events.reduce((max, event) => Math.max(max, event.seq), 0)
  }

  async resetMemory(): Promise<void> {
    // File-backed store has no in-memory state to reset.
  }

  private threadDir(threadId: string): string {
    return join(this.dataDir, threadId)
  }

  private eventsPath(threadId: string): string {
    return join(this.threadDir(threadId), 'events.jsonl')
  }

  private messagesPath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages.jsonl')
  }

  private sessionPath(threadId: string): string {
    return join(this.threadDir(threadId), 'session.json')
  }

  private async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  private async atomicWrite(path: string, contents: string): Promise<void> {
    await atomicWriteFile(path, contents)
  }

  private async compactUsageEventsIfLarge(threadId: string): Promise<void> {
    const path = this.eventsPath(threadId)
    const info = await stat(path).catch(() => null)
    if (!info || info.size <= this.usageEventCompaction.maxBytes) return
    const events = await readJsonl<RuntimeEvent>(path)
    const compacted = compactUsageEvents(events, {
      nowIso: this.usageEventCompaction.nowIso(),
      retentionDays: this.usageEventCompaction.retentionDays
    })
    if (compacted.length >= events.length) return
    const contents = compacted.map((event) => JSON.stringify(event)).join('\n')
    await this.atomicWrite(path, contents ? `${contents}\n` : '')
  }

  /** Used by the loop during shutdown to verify the file actually exists. */
  async exists(threadId: string): Promise<boolean> {
    try {
      await stat(this.threadDir(threadId))
      return true
    } catch {
      return false
    }
  }
}

function compactUsageEvents(
  events: RuntimeEvent[],
  options: { nowIso: string; retentionDays: number }
): RuntimeEvent[] {
  const cutoffMs = Date.parse(options.nowIso) - options.retentionDays * MS_PER_DAY
  if (!Number.isFinite(cutoffMs)) return events

  let latestUsageIndex = -1
  let latestBeforeCutoffIndex = -1
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.kind !== 'usage') continue
    latestUsageIndex = index
    const timestamp = Date.parse(event.timestamp)
    if (Number.isFinite(timestamp) && timestamp < cutoffMs) {
      latestBeforeCutoffIndex = index
    }
  }
  if (latestUsageIndex < 0) return events

  const keep = new Set<number>()
  const latestUsageIndexByBucket = new Map<string, number>()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.kind !== 'usage') {
      keep.add(index)
      continue
    }
    if (!shouldRetainUsageEvent(event, index, {
      cutoffMs,
      latestUsageIndex,
      latestBeforeCutoffIndex
    })) {
      continue
    }
    const bucket = usageCoalescingBucket(event)
    const previous = latestUsageIndexByBucket.get(bucket)
    if (previous !== undefined && previous !== latestBeforeCutoffIndex) {
      keep.delete(previous)
    }
    keep.add(index)
    latestUsageIndexByBucket.set(bucket, index)
  }

  return events.filter((_event, index) => keep.has(index))
}

function shouldRetainUsageEvent(
  event: RuntimeEvent,
  index: number,
  options: { cutoffMs: number; latestUsageIndex: number; latestBeforeCutoffIndex: number }
): boolean {
  if (event.kind !== 'usage') return true
  if (index === options.latestUsageIndex || index === options.latestBeforeCutoffIndex) return true
  const timestamp = Date.parse(event.timestamp)
  if (!Number.isFinite(timestamp)) return true
  return timestamp >= options.cutoffMs
}

function usageCoalescingBucket(event: RuntimeEvent): string {
  if (event.kind !== 'usage') return ''
  const day = Number.isFinite(Date.parse(event.timestamp))
    ? new Date(event.timestamp).toISOString().slice(0, 10)
    : event.timestamp
  return `${day}:${event.model ?? ''}`
}

function warnUsageCompaction(threadId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] usage event compaction failed for ${threadId}; keeping append-only log: ${message}`)
}
