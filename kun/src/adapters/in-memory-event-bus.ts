import type { EventBus } from '../ports/event-bus.js'
import type { RuntimeEvent } from '../contracts/events.js'

/**
 * In-memory implementation of the event bus used by tests and the
 * default runtime. Subscribers receive only events for their thread.
 * The bus is a single source of truth for the SSE replay path.
 */
export class InMemoryEventBus implements EventBus {
  private readonly events = new Map<string, RuntimeEvent[]>()
  private readonly subscribers = new Map<string, Set<(event: RuntimeEvent) => void>>()
  private nextSeq = new Map<string, number>()

  publish(event: RuntimeEvent): void {
    const list = this.events.get(event.threadId) ?? []
    list.push(event)
    this.events.set(event.threadId, list)
    const subscribers = this.subscribers.get(event.threadId)
    if (!subscribers) return
    for (const handler of subscribers) {
      try {
        handler(event)
      } catch {
        // Subscribers should not throw; isolate failures so publishing continues.
      }
    }
  }

  subscribe(threadId: string, handler: (event: RuntimeEvent) => void): () => void {
    const set = this.subscribers.get(threadId) ?? new Set()
    set.add(handler)
    this.subscribers.set(threadId, set)
    return () => {
      set.delete(handler)
    }
  }

  snapshotSince(threadId: string, sinceSeq: number): RuntimeEvent[] {
    const list = this.events.get(threadId) ?? []
    return list.filter((event) => event.seq > sinceSeq)
  }

  highestSeq(threadId: string): number {
    const list = this.events.get(threadId) ?? []
    return list.reduce((max, event) => Math.max(max, event.seq), 0)
  }

  /** Returns the next per-thread `seq` value, allocating one if needed. */
  allocateSeq(threadId: string): number {
    const next = (this.nextSeq.get(threadId) ?? this.highestSeq(threadId)) + 1
    this.nextSeq.set(threadId, next)
    return next
  }

  reset(): void {
    this.events.clear()
    this.subscribers.clear()
    this.nextSeq.clear()
  }
}
