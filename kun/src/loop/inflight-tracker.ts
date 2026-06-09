/**
 * Tracks running model and tool work with stable ids and guarantees
 * cleanup on success, error, and abort. The tracker is the authoritative
 * source for the SSE event stream: every `begin` corresponds to a
 * `tool_call_started` / `tool_call_finished` pair, and the loop never
 * leaks ids.
 */
export type InflightKind = 'model' | 'tool'

export type InflightRecord = {
  id: string
  kind: InflightKind
  threadId: string
  turnId?: string
  callId?: string
  startedAt: number
}

export class InflightTracker {
  private readonly entries = new Map<string, InflightRecord>()

  begin(record: Omit<InflightRecord, 'startedAt'> & { startedAt?: number }): InflightRecord {
    const full: InflightRecord = { ...record, startedAt: record.startedAt ?? Date.now() }
    this.entries.set(full.id, full)
    return full
  }

  end(id: string): InflightRecord | undefined {
    const record = this.entries.get(id)
    if (!record) return undefined
    this.entries.delete(id)
    return record
  }

  /**
   * `run` registers an inflight id, runs `work`, and guarantees the
   * id is removed even when the work throws or the abort signal
   * fires. Returns whatever the work resolves to.
   */
  async run<T>(
    record: Omit<InflightRecord, 'startedAt'>,
    work: () => Promise<T>
  ): Promise<T> {
    this.begin(record)
    try {
      return await work()
    } finally {
      this.end(record.id)
    }
  }

  get(id: string): InflightRecord | undefined {
    return this.entries.get(id)
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  list(): InflightRecord[] {
    return [...this.entries.values()]
  }

  abortAll(reason = 'aborted'): string[] {
    const ids = [...this.entries.keys()]
    this.entries.clear()
    return ids.map((id) => `${id}:${reason}`)
  }

  size(): number {
    return this.entries.size
  }
}
