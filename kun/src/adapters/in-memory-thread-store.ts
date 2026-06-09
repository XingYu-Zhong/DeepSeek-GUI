import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { toThreadSummary } from '../domain/thread.js'

/**
 * In-memory thread store. Used by tests and the file-backed
 * implementation is layered on top in section 3.4.
 */
export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, ThreadRecord>()

  async list(_options?: ThreadStoreListOptions): Promise<ThreadSummary[]> {
    return [...this.threads.values()]
      .map(toThreadSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    return this.threads.get(threadId) ?? null
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    this.threads.set(thread.id, thread)
    return thread
  }

  async delete(threadId: string): Promise<boolean> {
    return this.threads.delete(threadId)
  }
}
