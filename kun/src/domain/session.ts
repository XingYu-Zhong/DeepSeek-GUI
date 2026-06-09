import type { TurnItem } from '../contracts/items.js'
import type { RuntimeEvent } from '../contracts/events.js'

/**
 * An "agent session" is a persisted projection over the loop. It pairs
 * the turn item history with the canonical runtime event log so a new
 * subscriber can rebuild the conversation by reading JSONL alone.
 *
 * Sessions are intentionally append-only. They are the unit of replay
 * used by `AppendOnlySessionLog`.
 */
export type AgentSession = {
  threadId: string
  turnId: string
  startedAt: string
  updatedAt: string
  items: TurnItem[]
  events: RuntimeEvent[]
  closed: boolean
}

export function createAgentSession(input: {
  threadId: string
  turnId: string
  startedAt?: string
}): AgentSession {
  const now = input.startedAt ?? new Date().toISOString()
  return {
    threadId: input.threadId,
    turnId: input.turnId,
    startedAt: now,
    updatedAt: now,
    items: [],
    events: [],
    closed: false
  }
}

export function appendSessionItem(
  session: AgentSession,
  item: TurnItem
): AgentSession {
  if (session.items.some((existing) => existing.id === item.id)) {
    return session
  }
  return {
    ...session,
    items: [...session.items, item],
    updatedAt: new Date().toISOString()
  }
}

export function updateSessionItem(
  session: AgentSession,
  itemId: string,
  patch: Partial<TurnItem>
): AgentSession {
  let changed = false
  const items = session.items.map((item) => {
    if (item.id !== itemId) return item
    changed = true
    return { ...item, ...patch } as TurnItem
  })
  if (!changed) return session
  return {
    ...session,
    items,
    updatedAt: new Date().toISOString()
  }
}

export function appendSessionEvent(
  session: AgentSession,
  event: RuntimeEvent
): AgentSession {
  if (session.events.some((existing) => existing.seq === event.seq)) {
    return session
  }
  return {
    ...session,
    events: [...session.events, event],
    updatedAt: new Date().toISOString()
  }
}

export function closeSession(session: AgentSession): AgentSession {
  return { ...session, closed: true, updatedAt: new Date().toISOString() }
}
