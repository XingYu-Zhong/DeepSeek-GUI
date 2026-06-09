import type { AgentSession } from '../domain/session.js'
import { appendSessionEvent, appendSessionItem, createAgentSession } from '../domain/session.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'

/**
 * Append-only session log with a bounded in-memory window and full
 * disk replay. The in-memory window is the fast path; older events
 * are evicted from memory and live in the file-backed store.
 */
export class AppendOnlySessionLog {
  private session: AgentSession | null = null
  private readonly windowSize: number

  /**
   * `windowSize` controls the maximum number of items/events kept
   * in memory per session. The full history is still written to
   * `SessionStore`; replay uses `loadEventsSince`.
   */
  constructor(windowSize = 1_000) {
    this.windowSize = Math.max(1, windowSize)
  }

  load(session: AgentSession): void {
    this.session = session
  }

  ensureSession(input: { threadId: string; turnId: string }): AgentSession {
    if (!this.session) {
      this.session = createAgentSession(input)
    }
    return this.session
  }

  appendItem(item: TurnItem): AgentSession {
    this.session = this.session
      ? appendSessionItem(this.session, item)
      : appendSessionItem(
          createAgentSession({ threadId: item.threadId, turnId: item.turnId }),
          item
        )
    this.evict()
    return this.session
  }

  appendEvent(event: RuntimeEvent): AgentSession {
    this.session = this.session
      ? appendSessionEvent(this.session, event)
      : appendSessionEvent(
          createAgentSession({ threadId: event.threadId, turnId: event.turnId ?? '' }),
          event
        )
    this.evict()
    return this.session
  }

  current(): AgentSession | null {
    return this.session
  }

  items(): TurnItem[] {
    return this.session?.items ?? []
  }

  events(): RuntimeEvent[] {
    return this.session?.events ?? []
  }

  private evict(): void {
    if (!this.session) return
    if (this.session.items.length > this.windowSize) {
      const items = this.session.items.slice(-this.windowSize)
      this.session = { ...this.session, items }
    }
    if (this.session.events.length > this.windowSize) {
      const events = this.session.events.slice(-this.windowSize)
      this.session = { ...this.session, events }
    }
  }
}
