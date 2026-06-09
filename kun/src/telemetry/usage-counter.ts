import type { UsageSnapshot } from '../contracts/usage.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'

/**
 * Per-thread usage counter. The counter accumulates token, cache,
 * turn, and cost counters across model responses. The counter never
 * throws; missing values fall back to zero/empty.
 */
export class UsageCounter {
  private perThread = new Map<string, UsageSnapshot>()

  reset(threadId?: string): void {
    if (threadId === undefined) {
      this.perThread.clear()
      return
    }
    this.perThread.delete(threadId)
  }

  seed(threadId: string, snapshot: UsageSnapshot): UsageSnapshot {
    const next = normalizeUsageSnapshot(snapshot)
    this.perThread.set(threadId, next)
    return next
  }

  /**
   * Fold a usage snapshot into the per-thread counter. When the
   * provider does not report cache metrics, `cacheHitRate` is
   * preserved as `null` to signal "unknown".
   */
  record(threadId: string, snapshot: UsageSnapshot): UsageSnapshot {
    const current = this.perThread.get(threadId) ?? emptyUsageSnapshot()
    const promptTokens = current.promptTokens + snapshot.promptTokens
    const completionTokens = current.completionTokens + snapshot.completionTokens
    const totalTokens = promptTokens + completionTokens
    const cachedTokens =
      (current.cachedTokens ?? 0) + (snapshot.cachedTokens ?? 0)
    const cacheHitTokens =
      (current.cacheHitTokens ?? 0) + (snapshot.cacheHitTokens ?? 0)
    const cacheMissTokens =
      (current.cacheMissTokens ?? 0) + (snapshot.cacheMissTokens ?? 0)
    const cacheTotal = cacheHitTokens + cacheMissTokens
    const cacheHitRate =
      cacheTotal === 0
        ? null
        : cacheHitTokens / cacheTotal
    const turns = current.turns + (snapshot.turns > 0 ? snapshot.turns : 1)
    const costUsd =
      current.costUsd === undefined && snapshot.costUsd === undefined
        ? undefined
        : (current.costUsd ?? 0) + (snapshot.costUsd ?? 0)
    const costCny =
      current.costCny === undefined && snapshot.costCny === undefined
        ? undefined
        : (current.costCny ?? 0) + (snapshot.costCny ?? 0)
    const cacheSavingsUsd =
      current.cacheSavingsUsd === undefined && snapshot.cacheSavingsUsd === undefined
        ? undefined
        : (current.cacheSavingsUsd ?? 0) + (snapshot.cacheSavingsUsd ?? 0)
    const cacheSavingsCny =
      current.cacheSavingsCny === undefined && snapshot.cacheSavingsCny === undefined
        ? undefined
        : (current.cacheSavingsCny ?? 0) + (snapshot.cacheSavingsCny ?? 0)
    const tokenEconomySavingsTokens =
      (current.tokenEconomySavingsTokens ?? 0) + (snapshot.tokenEconomySavingsTokens ?? 0)
    const tokenEconomySavingsUsd =
      current.tokenEconomySavingsUsd === undefined && snapshot.tokenEconomySavingsUsd === undefined
        ? undefined
        : (current.tokenEconomySavingsUsd ?? 0) + (snapshot.tokenEconomySavingsUsd ?? 0)
    const tokenEconomySavingsCny =
      current.tokenEconomySavingsCny === undefined && snapshot.tokenEconomySavingsCny === undefined
        ? undefined
        : (current.tokenEconomySavingsCny ?? 0) + (snapshot.tokenEconomySavingsCny ?? 0)
    const next: UsageSnapshot = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens,
      cacheHitTokens,
      cacheMissTokens,
      cacheHitRate,
      turns,
      costUsd,
      costCny,
      cacheSavingsUsd,
      cacheSavingsCny,
      tokenEconomySavingsTokens,
      tokenEconomySavingsUsd,
      tokenEconomySavingsCny,
      hasError: snapshot.hasError
    }
    this.perThread.set(threadId, next)
    return next
  }

  recordTokenEconomySavings(
    threadId: string,
    savings: Pick<
      UsageSnapshot,
      'tokenEconomySavingsTokens' | 'tokenEconomySavingsUsd' | 'tokenEconomySavingsCny'
    >
  ): UsageSnapshot {
    const current = this.perThread.get(threadId) ?? emptyUsageSnapshot()
    const next: UsageSnapshot = {
      ...current,
      tokenEconomySavingsTokens:
        (current.tokenEconomySavingsTokens ?? 0) + (savings.tokenEconomySavingsTokens ?? 0),
      tokenEconomySavingsUsd:
        current.tokenEconomySavingsUsd === undefined && savings.tokenEconomySavingsUsd === undefined
          ? undefined
          : (current.tokenEconomySavingsUsd ?? 0) + (savings.tokenEconomySavingsUsd ?? 0),
      tokenEconomySavingsCny:
        current.tokenEconomySavingsCny === undefined && savings.tokenEconomySavingsCny === undefined
          ? undefined
          : (current.tokenEconomySavingsCny ?? 0) + (savings.tokenEconomySavingsCny ?? 0)
    }
    this.perThread.set(threadId, next)
    return next
  }

  total(): UsageSnapshot {
    const totals = [...this.perThread.values()].reduce((acc, snapshot) => {
      return mergeUsage(acc, snapshot)
    }, emptyUsageSnapshot())
    return totals
  }

  forThread(threadId: string): UsageSnapshot {
    return this.perThread.get(threadId) ?? emptyUsageSnapshot()
  }
}

function normalizeUsageSnapshot(snapshot: UsageSnapshot): UsageSnapshot {
  const promptTokens = Math.max(0, Math.floor(snapshot.promptTokens))
  const completionTokens = Math.max(0, Math.floor(snapshot.completionTokens))
  const totalTokens = Math.max(0, Math.floor(snapshot.totalTokens || promptTokens + completionTokens))
  const cachedTokens = snapshot.cachedTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cachedTokens))
    : undefined
  const cacheHitTokens = snapshot.cacheHitTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cacheHitTokens))
    : undefined
  const cacheMissTokens = snapshot.cacheMissTokens !== undefined
    ? Math.max(0, Math.floor(snapshot.cacheMissTokens))
    : undefined
  const cacheTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    cacheHitRate: cacheHitTokens !== undefined && cacheTotal > 0 ? cacheHitTokens / cacheTotal : null,
    turns: Math.max(0, Math.floor(snapshot.turns)),
    ...(snapshot.costUsd !== undefined ? { costUsd: Math.max(0, snapshot.costUsd) } : {}),
    ...(snapshot.costCny !== undefined ? { costCny: Math.max(0, snapshot.costCny) } : {}),
    ...(snapshot.cacheSavingsUsd !== undefined ? { cacheSavingsUsd: Math.max(0, snapshot.cacheSavingsUsd) } : {}),
    ...(snapshot.cacheSavingsCny !== undefined ? { cacheSavingsCny: Math.max(0, snapshot.cacheSavingsCny) } : {}),
    ...(snapshot.tokenEconomySavingsTokens !== undefined
      ? { tokenEconomySavingsTokens: Math.max(0, Math.floor(snapshot.tokenEconomySavingsTokens)) }
      : {}),
    ...(snapshot.tokenEconomySavingsUsd !== undefined
      ? { tokenEconomySavingsUsd: Math.max(0, snapshot.tokenEconomySavingsUsd) }
      : {}),
    ...(snapshot.tokenEconomySavingsCny !== undefined
      ? { tokenEconomySavingsCny: Math.max(0, snapshot.tokenEconomySavingsCny) }
      : {}),
    ...(snapshot.hasError ? { hasError: true } : {})
  }
}

function mergeUsage(into: UsageSnapshot, delta: UsageSnapshot): UsageSnapshot {
  const promptTokens = into.promptTokens + delta.promptTokens
  const completionTokens = into.completionTokens + delta.completionTokens
  const totalTokens = promptTokens + completionTokens
  const cachedTokens = (into.cachedTokens ?? 0) + (delta.cachedTokens ?? 0)
  const cacheHitTokens =
    (into.cacheHitTokens ?? 0) + (delta.cacheHitTokens ?? 0)
  const cacheMissTokens =
    (into.cacheMissTokens ?? 0) + (delta.cacheMissTokens ?? 0)
  const cacheTotal = cacheHitTokens + cacheMissTokens
  const cacheHitRate =
    cacheTotal === 0 ? null : cacheHitTokens / cacheTotal
  const turns = into.turns + delta.turns
  const costUsd =
    into.costUsd === undefined && delta.costUsd === undefined
      ? undefined
      : (into.costUsd ?? 0) + (delta.costUsd ?? 0)
  const costCny =
    into.costCny === undefined && delta.costCny === undefined
      ? undefined
      : (into.costCny ?? 0) + (delta.costCny ?? 0)
  const cacheSavingsUsd =
    into.cacheSavingsUsd === undefined && delta.cacheSavingsUsd === undefined
      ? undefined
      : (into.cacheSavingsUsd ?? 0) + (delta.cacheSavingsUsd ?? 0)
  const cacheSavingsCny =
    into.cacheSavingsCny === undefined && delta.cacheSavingsCny === undefined
      ? undefined
      : (into.cacheSavingsCny ?? 0) + (delta.cacheSavingsCny ?? 0)
  const tokenEconomySavingsTokens =
    (into.tokenEconomySavingsTokens ?? 0) + (delta.tokenEconomySavingsTokens ?? 0)
  const tokenEconomySavingsUsd =
    into.tokenEconomySavingsUsd === undefined && delta.tokenEconomySavingsUsd === undefined
      ? undefined
      : (into.tokenEconomySavingsUsd ?? 0) + (delta.tokenEconomySavingsUsd ?? 0)
  const tokenEconomySavingsCny =
    into.tokenEconomySavingsCny === undefined && delta.tokenEconomySavingsCny === undefined
      ? undefined
      : (into.tokenEconomySavingsCny ?? 0) + (delta.tokenEconomySavingsCny ?? 0)
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate,
    turns,
    costUsd,
    costCny,
    cacheSavingsUsd,
    cacheSavingsCny,
    tokenEconomySavingsTokens,
    tokenEconomySavingsUsd,
    tokenEconomySavingsCny
  }
}
