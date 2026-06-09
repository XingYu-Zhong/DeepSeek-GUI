import type { UsageSnapshot } from '../contracts/usage.js'

/**
 * Cache telemetry accumulator. The accumulator folds cache counters
 * from model responses, compaction summaries, and explicit mutations
 * into a per-thread snapshot. The snapshot is the source of truth for
 * the GUI's "cache hit rate" badge.
 */
export class CacheTelemetry {
  private readonly hits = new Map<string, number>()
  private readonly misses = new Map<string, number>()
  private readonly writes = new Map<string, number>()
  private readonly invalidations = new Map<string, number>()

  recordHit(threadId: string, tokens: number): void {
    this.hits.set(threadId, (this.hits.get(threadId) ?? 0) + tokens)
  }

  recordMiss(threadId: string, tokens: number): void {
    this.misses.set(threadId, (this.misses.get(threadId) ?? 0) + tokens)
  }

  recordWrite(threadId: string, tokens: number): void {
    this.writes.set(threadId, (this.writes.get(threadId) ?? 0) + tokens)
  }

  recordInvalidation(threadId: string): void {
    this.invalidations.set(
      threadId,
      (this.invalidations.get(threadId) ?? 0) + 1
    )
  }

  ingest(threadId: string, usage: UsageSnapshot): void {
    if (usage.cacheHitTokens) this.recordHit(threadId, usage.cacheHitTokens)
    if (usage.cacheMissTokens) this.recordMiss(threadId, usage.cacheMissTokens)
    if (usage.cachedTokens && usage.cachedTokens > (usage.cacheHitTokens ?? 0)) {
      this.recordWrite(threadId, usage.cachedTokens - (usage.cacheHitTokens ?? 0))
    }
  }

  snapshot(threadId: string): {
    hits: number
    misses: number
    writes: number
    invalidations: number
    hitRate: number | null
  } {
    const hits = this.hits.get(threadId) ?? 0
    const misses = this.misses.get(threadId) ?? 0
    const total = hits + misses
    return {
      hits,
      misses,
      writes: this.writes.get(threadId) ?? 0,
      invalidations: this.invalidations.get(threadId) ?? 0,
      hitRate: total === 0 ? null : hits / total
    }
  }

  reset(threadId?: string): void {
    if (threadId === undefined) {
      this.hits.clear()
      this.misses.clear()
      this.writes.clear()
      this.invalidations.clear()
      return
    }
    this.hits.delete(threadId)
    this.misses.delete(threadId)
    this.writes.delete(threadId)
    this.invalidations.delete(threadId)
  }
}
