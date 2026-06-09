import { encodeSseEvent } from '../sse.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'

const HEARTBEAT_INTERVAL_MS = 15_000

/**
 * Build an SSE response for `GET /v1/threads/{id}/events`.
 *
 * The handler first replays persisted events with `seq` greater than
 * `since_seq`, then subscribes to the event bus to deliver live
 * updates. The stream closes when the request's `AbortSignal`
 * fires (the client disconnects) or the server stops publishing.
 */
export function buildEventStreamResponse(input: {
  request: Request
  threadId: string
  eventBus: EventBus
  sessionStore: SessionStore
  allocateSeq: (threadId: string) => number
}): Response {
  const url = new URL(input.request.url)
  const sinceSeqFromQuery = Number(url.searchParams.get('since_seq') ?? '0') || 0
  const sinceSeqFromHeader = Number(input.request.headers.get('Last-Event-ID') ?? '0') || 0
  const sinceSeq = sinceSeqFromQuery || sinceSeqFromHeader
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = undefined
        }
        try {
          controller.close()
        } catch {
          // Already closed; ignore.
        }
      }
      input.request.signal.addEventListener('abort', close)
      try {
        const backlog = await input.sessionStore.loadEventsSince(input.threadId, sinceSeq)
        for (const event of backlog) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)))
        }
        unsubscribe = input.eventBus.subscribe(input.threadId, (event: RuntimeEvent) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(encodeSseEvent(event)))
          } catch {
            close()
          }
        })
        heartbeatTimer = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(
              encoder.encode(
                encodeSseEvent({
                  kind: 'heartbeat',
                  seq: input.allocateSeq(input.threadId),
                  timestamp: new Date().toISOString(),
                  threadId: input.threadId
                })
              )
            )
          } catch {
            close()
          }
        }, HEARTBEAT_INTERVAL_MS)
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : String(error)
            })}\n\n`
          )
        )
        close()
      }
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    }
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}
