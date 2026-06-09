import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'

export type ThreadStoreListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
}

/**
 * Port for persistent thread storage. Implementations use a JSONL
 * messages log plus a queryable index; the in-memory implementation is
 * used by tests.
 */
export interface ThreadStore {
  list(options?: ThreadStoreListOptions): Promise<ThreadSummary[]>
  get(threadId: string): Promise<ThreadRecord | null>
  upsert(thread: ThreadRecord): Promise<ThreadRecord>
  delete(threadId: string): Promise<boolean>
}
