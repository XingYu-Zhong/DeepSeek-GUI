import type { NormalizedThread } from '../agent/types'
import { browserStorage, type BrowserStorageLike } from './browser-storage'

export type ThreadForkRecord = {
  parentThreadId: string
  parentTitle?: string
  createdAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
}

export type ThreadForkRegistry = {
  version: 1
  forks: Record<string, ThreadForkRecord>
}

export const MAX_THREAD_FORK_REGISTRY_ENTRIES = 500

const THREAD_FORK_REGISTRY_KEY = 'deepseekgui.threadForks.v1'

export function emptyThreadForkRegistry(): ThreadForkRegistry {
  return { version: 1, forks: {} }
}

function normalizeThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = normalizeThreadId(value)
  return text || undefined
}

function normalizeOptionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function trimForkRegistryEntries(forks: ThreadForkRegistry['forks']): ThreadForkRegistry['forks'] {
  return Object.fromEntries(Object.entries(forks).slice(-MAX_THREAD_FORK_REGISTRY_ENTRIES))
}

export function normalizeThreadForkRegistry(raw: unknown): ThreadForkRegistry {
  if (!raw || typeof raw !== 'object') return emptyThreadForkRegistry()
  const source = raw as { forks?: unknown }
  if (!source.forks || typeof source.forks !== 'object') return emptyThreadForkRegistry()

  const forks: ThreadForkRegistry['forks'] = {}
  for (const [threadIdKey, value] of Object.entries(source.forks as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const threadId = normalizeThreadId(threadIdKey)
    const record = value as Record<string, unknown>
    const parentThreadId = normalizeThreadId(record.parentThreadId)
    if (!threadId || !parentThreadId || threadId === parentThreadId) continue
    const parentTitle = normalizeOptionalString(record.parentTitle)
    const createdAt = normalizeOptionalString(record.createdAt)
    const forkedFromMessageCount = normalizeOptionalCount(record.forkedFromMessageCount)
    const forkedFromTurnCount = normalizeOptionalCount(record.forkedFromTurnCount)
    delete forks[threadId]
    forks[threadId] = {
      parentThreadId,
      ...(parentTitle ? { parentTitle } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(forkedFromMessageCount !== undefined ? { forkedFromMessageCount } : {}),
      ...(forkedFromTurnCount !== undefined ? { forkedFromTurnCount } : {})
    }
  }

  return { version: 1, forks: trimForkRegistryEntries(forks) }
}

export function readThreadForkRegistry(storage: BrowserStorageLike | null = browserStorage()): ThreadForkRegistry {
  if (!storage) return emptyThreadForkRegistry()
  try {
    const raw = storage.getItem(THREAD_FORK_REGISTRY_KEY)
    return normalizeThreadForkRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyThreadForkRegistry()
  }
}

export function saveThreadForkRegistry(
  registry: ThreadForkRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(THREAD_FORK_REGISTRY_KEY, JSON.stringify(normalizeThreadForkRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

export function markThreadFork(
  threadId: string,
  parent: Pick<NormalizedThread, 'id' | 'title'>,
  options: {
    createdAt?: string
    forkedFromMessageCount?: number
    forkedFromTurnCount?: number
  } = {},
  registry: ThreadForkRegistry = readThreadForkRegistry()
): ThreadForkRegistry {
  const id = normalizeThreadId(threadId)
  const parentThreadId = normalizeThreadId(parent.id)
  if (!id || !parentThreadId || id === parentThreadId) return registry
  const createdAt = normalizeOptionalString(options.createdAt)
  const forkedFromMessageCount = normalizeOptionalCount(options.forkedFromMessageCount)
  const forkedFromTurnCount = normalizeOptionalCount(options.forkedFromTurnCount)
  const record: ThreadForkRecord = {
    parentThreadId,
    ...(parent.title.trim() ? { parentTitle: parent.title.trim() } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(forkedFromMessageCount !== undefined ? { forkedFromMessageCount } : {}),
    ...(forkedFromTurnCount !== undefined ? { forkedFromTurnCount } : {})
  }
  const forks = { ...registry.forks }
  delete forks[id]
  return normalizeThreadForkRegistry({
    ...registry,
    forks: {
      ...forks,
      [id]: record
    }
  })
}

export function forgetThreadFork(
  threadId: string,
  registry: ThreadForkRegistry = readThreadForkRegistry()
): ThreadForkRegistry {
  const id = normalizeThreadId(threadId)
  if (!id || !registry.forks[id]) return registry
  const forks = { ...registry.forks }
  delete forks[id]
  return normalizeThreadForkRegistry({ version: 1, forks })
}

export function hydrateThreadForkRegistry(
  threads: NormalizedThread[],
  registry: ThreadForkRegistry = readThreadForkRegistry()
): ThreadForkRegistry {
  const normalized = normalizeThreadForkRegistry(registry)
  const ids = new Set(threads.map((thread) => thread.id).filter(Boolean))
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const forks: ThreadForkRegistry['forks'] = {}

  for (const thread of threads) {
    const record = normalized.forks[thread.id]
    if (record && ids.has(thread.id)) forks[thread.id] = record
    if (!thread.forkedFromThreadId || thread.forkedFromThreadId === thread.id) continue
    const parent = byId.get(thread.forkedFromThreadId)
    const forkedFromMessageCount = thread.forkedFromMessageCount ?? record?.forkedFromMessageCount
    const forkedFromTurnCount = thread.forkedFromTurnCount ?? record?.forkedFromTurnCount
    forks[thread.id] = {
      parentThreadId: thread.forkedFromThreadId,
      ...(thread.forkedFromTitle || parent?.title || record?.parentTitle
        ? { parentTitle: thread.forkedFromTitle || parent?.title || record?.parentTitle }
        : {}),
      ...(thread.forkedAt || record?.createdAt ? { createdAt: thread.forkedAt || record?.createdAt } : {}),
      ...(forkedFromMessageCount !== undefined ? { forkedFromMessageCount } : {}),
      ...(forkedFromTurnCount !== undefined ? { forkedFromTurnCount } : {})
    }
  }

  return normalizeThreadForkRegistry({ version: 1, forks })
}

export function enrichThreadsWithForkInfo(
  threads: NormalizedThread[],
  registry: ThreadForkRegistry = readThreadForkRegistry()
): NormalizedThread[] {
  const normalized = normalizeThreadForkRegistry(registry)
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  return threads.map((thread) => {
    const record = normalized.forks[thread.id]
    const parentThreadId = thread.forkedFromThreadId || record?.parentThreadId
    if (!parentThreadId || parentThreadId === thread.id) return thread
    const parentTitle = thread.forkedFromTitle || byId.get(parentThreadId)?.title || record?.parentTitle
    const forkedFromMessageCount = thread.forkedFromMessageCount ?? record?.forkedFromMessageCount
    const forkedFromTurnCount = thread.forkedFromTurnCount ?? record?.forkedFromTurnCount
    return {
      ...thread,
      forkedFromThreadId: parentThreadId,
      ...(parentTitle ? { forkedFromTitle: parentTitle } : {}),
      ...(thread.forkedAt || record?.createdAt ? { forkedAt: thread.forkedAt || record?.createdAt } : {}),
      ...(forkedFromMessageCount !== undefined ? { forkedFromMessageCount } : {}),
      ...(forkedFromTurnCount !== undefined ? { forkedFromTurnCount } : {})
    }
  })
}
