import type { UsageService } from '../../services/usage-service.js'
import {
  buildDailyUsageResponse,
  buildModelUsageResponse,
  buildThreadUsageResponse,
  parseDailyUsageQuery,
  parseModelUsageQuery,
  UsageValidationError,
  type ThreadUsageRecord
} from '../../services/usage-service.js'
import {
  emptyUsageSnapshot,
  type UsageSnapshot
} from '../../contracts/usage.js'
import type { UsageEvent } from '../../contracts/events.js'
import type { ServerRuntime } from './server-runtime.js'
import { jsonResponse, type JsonResponse } from '../response.js'

/**
 * Usage endpoint response shape. The `total` field mirrors the
 * per-thread cumulative usage snapshot; `perThread` exposes a list
 * of per-thread usage values for the GUI's connection status.
 */
export type UsageEndpointResponse = {
  total: ReturnType<UsageService['total']>
  perThread: Array<{ threadId: string; usage: ReturnType<UsageService['forThread']> }>
}

export async function buildUsageResponse(runtime: ServerRuntime): Promise<UsageEndpointResponse> {
  const threads = await runtime.threadService.list()
  return {
    total: runtime.usageService.total(),
    perThread: threads.map((thread) => ({
      threadId: thread.id,
      usage: runtime.usageService.forThread(thread.id)
    }))
  }
}

export async function usageJsonResponse(
  request: Request,
  runtime: ServerRuntime
): Promise<JsonResponse> {
  const query = queryRecord(request)
  const groupBy = stringParam(query, 'group_by') ?? 'runtime'
  if (groupBy === 'thread') {
    return jsonResponse(buildThreadUsageResponse(await usageRecords(runtime)))
  }
  if (groupBy === 'day') {
    try {
      return jsonResponse(
        buildDailyUsageResponse(await usageRecords(runtime), parseDailyUsageQuery(query))
      )
    } catch (error) {
      if (error instanceof UsageValidationError) {
        return jsonResponse({ code: error.code, message: error.message }, 400)
      }
      throw error
    }
  }
  if (groupBy === 'model') {
    try {
      return jsonResponse(
        buildModelUsageResponse(await usageRecords(runtime), parseModelUsageQuery(query))
      )
    } catch (error) {
      if (error instanceof UsageValidationError) {
        return jsonResponse({ code: error.code, message: error.message }, 400)
      }
      throw error
    }
  }
  if (groupBy !== 'runtime') {
    return jsonResponse({ code: 'validation_error', message: `unsupported usage grouping: ${groupBy}` }, 400)
  }
  return jsonResponse(await buildUsageResponse(runtime))
}

function queryRecord(request: Request): Record<string, string> {
  const url = new URL(request.url)
  const record: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    record[key] = value
  }
  return record
}

function stringParam(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function usageRecords(runtime: ServerRuntime): Promise<ThreadUsageRecord[]> {
  const records: ThreadUsageRecord[] = []
  const threadSummaries = await runtime.threadService.list()
  for (const threadSummary of threadSummaries) {
    const thread = await runtime.threadService.get(threadSummary.id) ?? { ...threadSummary, turns: [] }
    let latestPersisted = emptyUsageSnapshot()
    const events = await runtime.sessionStore.loadEventsSince(thread.id, 0)
    const usageEvents = events
      .filter((event): event is UsageEvent => event.kind === 'usage')
      .sort((a, b) => a.seq - b.seq)

    for (const event of usageEvents) {
      const delta = diffUsage(event.usage, latestPersisted)
      latestPersisted = event.usage
      if (hasUsage(delta)) {
        records.push({
          threadId: thread.id,
          model: usageRecordModel(thread, event),
          completedAt: event.timestamp,
          usage: delta
        })
      }
    }

    const liveRemainder = diffUsage(runtime.usageService.forThread(thread.id), latestPersisted)
    if (hasUsage(liveRemainder)) {
      records.push({
        threadId: thread.id,
        model: usageRecordModel(thread, { turnId: thread.turns?.at(-1)?.id }),
        completedAt: thread.updatedAt || runtime.nowIso(),
        usage: liveRemainder
      })
    }
  }
  return records
}

function usageRecordModel(
  thread: {
    model?: string
    turns?: Array<{ id: string; model?: string }>
  },
  event?: Pick<UsageEvent, 'model' | 'turnId'>
): string {
  const eventModel = event?.model?.trim()
  if (eventModel) return eventModel

  const trimmedTurnId = event?.turnId?.trim() ?? ''
  if (trimmedTurnId) {
    const turnModel = thread.turns?.find((turn) => turn.id === trimmedTurnId)?.model?.trim()
    if (turnModel) return turnModel
  }
  const latestTurnModel = [...(thread.turns ?? [])]
    .reverse()
    .find((turn) => turn.model?.trim())
    ?.model?.trim()
  return latestTurnModel || thread.model?.trim() || 'unknown'
}

function diffUsage(current: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot {
  const promptTokens = diffNumber(current.promptTokens, previous.promptTokens)
  const completionTokens = diffNumber(current.completionTokens, previous.completionTokens)
  const reportedTotal = diffNumber(current.totalTokens, previous.totalTokens)
  const totalTokens = reportedTotal || promptTokens + completionTokens
  const cachedTokens = diffOptionalNumber(current.cachedTokens, previous.cachedTokens)
  const cacheHitTokens = diffOptionalNumber(current.cacheHitTokens, previous.cacheHitTokens)
  const cacheMissTokens = diffOptionalNumber(current.cacheMissTokens, previous.cacheMissTokens)
  const cacheTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  const cacheHitRate = cacheHitTokens !== undefined && cacheTotal > 0
    ? cacheHitTokens / cacheTotal
    : null
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    cacheHitRate,
    turns: diffNumber(current.turns, previous.turns),
    ...(current.costUsd !== undefined || previous.costUsd !== undefined
      ? { costUsd: diffNumber(current.costUsd ?? 0, previous.costUsd ?? 0) }
      : {}),
    ...(current.costCny !== undefined || previous.costCny !== undefined
      ? { costCny: diffNumber(current.costCny ?? 0, previous.costCny ?? 0) }
      : {}),
    ...(current.cacheSavingsUsd !== undefined || previous.cacheSavingsUsd !== undefined
      ? { cacheSavingsUsd: diffNumber(current.cacheSavingsUsd ?? 0, previous.cacheSavingsUsd ?? 0) }
      : {}),
    ...(current.cacheSavingsCny !== undefined || previous.cacheSavingsCny !== undefined
      ? { cacheSavingsCny: diffNumber(current.cacheSavingsCny ?? 0, previous.cacheSavingsCny ?? 0) }
      : {}),
    ...(current.tokenEconomySavingsTokens !== undefined || previous.tokenEconomySavingsTokens !== undefined
      ? {
          tokenEconomySavingsTokens: diffNumber(
            current.tokenEconomySavingsTokens ?? 0,
            previous.tokenEconomySavingsTokens ?? 0
          )
        }
      : {}),
    ...(current.tokenEconomySavingsUsd !== undefined || previous.tokenEconomySavingsUsd !== undefined
      ? {
          tokenEconomySavingsUsd: diffNumber(
            current.tokenEconomySavingsUsd ?? 0,
            previous.tokenEconomySavingsUsd ?? 0
          )
        }
      : {}),
    ...(current.tokenEconomySavingsCny !== undefined || previous.tokenEconomySavingsCny !== undefined
      ? {
          tokenEconomySavingsCny: diffNumber(
            current.tokenEconomySavingsCny ?? 0,
            previous.tokenEconomySavingsCny ?? 0
          )
        }
      : {}),
    ...(current.hasError ? { hasError: true } : {})
  }
}

function diffNumber(current: number, previous: number): number {
  return Math.max(0, current - previous)
}

function diffOptionalNumber(current?: number, previous?: number): number | undefined {
  if (current === undefined && previous === undefined) return undefined
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

function hasUsage(usage: UsageSnapshot): boolean {
  return usage.promptTokens > 0
    || usage.completionTokens > 0
    || usage.totalTokens > 0
    || (usage.cachedTokens ?? 0) > 0
    || (usage.cacheHitTokens ?? 0) > 0
    || (usage.cacheMissTokens ?? 0) > 0
    || usage.turns > 0
    || (usage.costUsd ?? 0) > 0
    || (usage.costCny ?? 0) > 0
    || (usage.cacheSavingsUsd ?? 0) > 0
    || (usage.cacheSavingsCny ?? 0) > 0
    || (usage.tokenEconomySavingsTokens ?? 0) > 0
    || (usage.tokenEconomySavingsUsd ?? 0) > 0
    || (usage.tokenEconomySavingsCny ?? 0) > 0
}
