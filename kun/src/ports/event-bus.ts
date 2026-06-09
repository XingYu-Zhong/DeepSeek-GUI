import type { RuntimeEvent } from '../contracts/events.js'

/**
 * Port for fanning out runtime events to subscribers (mostly the SSE
 * endpoint). The bus is in-memory and synchronous; the HTTP layer
 * replays the bus with `since_seq` to recover after reconnects.
 */
export interface EventBus {
  publish(event: RuntimeEvent): void
  subscribe(threadId: string, handler: (event: RuntimeEvent) => void): () => void
  /** Snapshot all events with `seq` greater than `sinceSeq`. */
  snapshotSince(threadId: string, sinceSeq: number): RuntimeEvent[]
  highestSeq(threadId: string): number
  reset(): void
}
