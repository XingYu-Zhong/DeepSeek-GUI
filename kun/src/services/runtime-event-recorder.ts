import {
  RuntimeEvent as RuntimeEventSchema,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'

type RuntimeEventWithoutStamp<Event extends RuntimeEvent> = Omit<Event, 'seq' | 'timestamp'> &
  Partial<Pick<Event, 'seq' | 'timestamp'>>

export type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? RuntimeEventWithoutStamp<Event>
    : never
  : never

export type RuntimeEventRecorderOptions = {
  eventBus: EventBus
  sessionStore: SessionStore
  allocateSeq: (threadId: string) => number
  nowIso: () => string
}

/**
 * Application-level event boundary.
 *
 * Services and loops produce semantic event drafts; this recorder
 * stamps ordering/time, validates the public contract, fans out to
 * live subscribers, and persists the same event for SSE replay.
 */
export class RuntimeEventRecorder {
  private readonly options: RuntimeEventRecorderOptions

  constructor(options: RuntimeEventRecorderOptions) {
    this.options = options
  }

  async record(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    const allocatedSeq = this.options.allocateSeq(draft.threadId)
    const persistedSeq = await this.options.sessionStore.highestSeq(draft.threadId)
    const event = RuntimeEventSchema.parse({
      ...draft,
      seq: draft.seq ?? Math.max(allocatedSeq, persistedSeq + 1),
      timestamp: draft.timestamp ?? this.options.nowIso()
    })
    this.options.eventBus.publish(event)
    await this.options.sessionStore.appendEvent(event.threadId, event)
    return event
  }
}
