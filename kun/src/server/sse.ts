import type { RuntimeEvent } from '../contracts/events.js'

export function encodeSseEvent(event: RuntimeEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}
