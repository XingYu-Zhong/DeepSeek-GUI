/**
 * Mid-turn steering queue. The renderer posts steering text while a
 * turn is running; the queue collects those messages and injects them
 * as user inputs at the next safe loop boundary. The queue is cleared
 * on turn completion or interruption.
 */
export class SteeringQueue {
  private readonly buffer: string[] = []
  private turnId: string | null = null

  setTurn(turnId: string | null): void {
    if (this.turnId !== turnId) {
      this.buffer.length = 0
    }
    this.turnId = turnId
  }

  enqueue(turnId: string, text: string): void {
    if (this.turnId !== turnId) {
      this.buffer.length = 0
      this.turnId = turnId
    }
    const trimmed = text.trim()
    if (!trimmed) return
    this.buffer.push(trimmed)
  }

  /**
   * Drain queued steering messages and return them. The loop calls
   * this at safe boundaries (after a model response, before the next
   * model request). Returns an empty array when nothing is pending.
   */
  drain(): string[] {
    if (this.buffer.length === 0) return []
    const out = [...this.buffer]
    this.buffer.length = 0
    return out
  }

  /**
   * Peek at the queued text without removing it. Used by the UI to
   * show pending steering in a "pending injection" indicator.
   */
  peek(): string[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer.length = 0
    this.turnId = null
  }
}
