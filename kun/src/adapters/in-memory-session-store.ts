import type { SessionStore } from '../ports/session-store.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { AgentSession } from '../domain/session.js'

/**
 * In-memory session store used by tests and the default runtime.
 *
 * The store keeps three views per thread:
 * - the in-memory event log (used by SSE replay)
 * - the in-memory item list (used to rebuild chat blocks)
 * - the canonical session projection (used to rehydrate on restart)
 */
export class InMemorySessionStore implements SessionStore {
  private readonly events = new Map<string, RuntimeEvent[]>()
  private readonly items = new Map<string, TurnItem[]>()
  private readonly sessions = new Map<string, AgentSession>()

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    const list = this.events.get(threadId) ?? []
    if (list.some((existing) => existing.seq === event.seq)) return
    list.push(event)
    this.events.set(threadId, list)
    const session = this.sessions.get(threadId)
    if (session) {
      this.sessions.set(threadId, {
        ...session,
        events: [...session.events, event],
        updatedAt: new Date().toISOString()
      })
    }
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    const list = this.items.get(threadId) ?? []
    const existingIndex = list.findIndex((existing) => existing.id === item.id)
    const nextList = existingIndex >= 0
      ? list.map((existing) => (existing.id === item.id ? item : existing))
      : [...list, item]
    this.items.set(threadId, nextList)
    const session = this.sessions.get(threadId)
    if (session) {
      this.sessions.set(threadId, {
        ...session,
        items: existingIndex >= 0
          ? session.items.map((existing) => (existing.id === item.id ? item : existing))
          : [...session.items, item],
        updatedAt: new Date().toISOString()
      })
    }
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    const nextItems = [...items]
    this.items.set(threadId, nextItems)
    const session = this.sessions.get(threadId)
    if (session) {
      this.sessions.set(threadId, {
        ...session,
        items: nextItems,
        updatedAt: new Date().toISOString()
      })
    }
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    const list = this.items.get(threadId) ?? []
    let updated: TurnItem | null = null
    const nextList = list.map((item) => {
      if (item.id !== itemId) return item
      updated = { ...item, ...patch } as TurnItem
      return updated
    })
    if (!updated) return null
    this.items.set(threadId, nextList)
    const session = this.sessions.get(threadId)
    if (session) {
      this.sessions.set(threadId, {
        ...session,
        items: nextList,
        updatedAt: new Date().toISOString()
      })
    }
    return updated
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    const list = this.events.get(threadId) ?? []
    return list
      .filter((event) => event.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq)
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    return [...(this.items.get(threadId) ?? [])]
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    return this.sessions.get(threadId) ?? null
  }

  async upsertSession(session: AgentSession): Promise<void> {
    this.sessions.set(session.threadId, session)
    if (!this.events.has(session.threadId)) {
      this.events.set(session.threadId, [...session.events])
    }
    if (!this.items.has(session.threadId)) {
      this.items.set(session.threadId, [...session.items])
    }
  }

  async highestSeq(threadId: string): Promise<number> {
    const list = this.events.get(threadId) ?? []
    return list.reduce((max, event) => Math.max(max, event.seq), 0)
  }

  async resetMemory(): Promise<void> {
    this.events.clear()
    this.items.clear()
    this.sessions.clear()
  }
}
