import type { RuntimeEvent, RuntimeEventKind } from '../contracts/events.js'

export type EventEntity = RuntimeEvent

/**
 * Compare two events by their monotonically increasing `seq` number.
 * Used by SSE replay and the inflight tracker to determine ordering.
 */
export function compareEventSeq(a: RuntimeEvent, b: RuntimeEvent): number {
  return a.seq - b.seq
}

/**
 * Group events by kind. Used by the event mapper when computing chat
 * block transitions and by tests to assert on emitted categories.
 */
export function groupEventsByKind(
  events: readonly RuntimeEvent[]
): Record<RuntimeEventKind, RuntimeEvent[]> {
  const out = {} as Record<RuntimeEventKind, RuntimeEvent[]>
  for (const event of events) {
    const bucket = out[event.kind]
    if (bucket) {
      bucket.push(event)
    } else {
      out[event.kind] = [event]
    }
  }
  return out
}
