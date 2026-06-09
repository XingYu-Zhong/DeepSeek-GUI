import type { NormalizedThread } from '../agent/types'
import { browserStorage, type BrowserStorageLike } from '../lib/browser-storage'
import type { SddDraft } from './sdd-draft-store'

const SDD_THREAD_REGISTRY_KEY = 'deepseekgui.sdd.threadRegistry.v1'
const MAX_SDD_THREAD_RECORDS = 100
const MAX_SDD_THREAD_IDS_PER_DRAFT = 20
const SDD_DRAFT_PATH_FRAGMENT = '.kunsdd/draft/'

export type SddThreadRecord = {
  draftId: string
  threadId: string
  threadIds: string[]
  publicThreadIds: string[]
  workspaceRoot: string
  updatedAt: string
}

export type SddThreadRegistry = {
  version: 1
  drafts: Record<string, SddThreadRecord>
}

type SddThreadLike =
  Pick<NormalizedThread, 'id'> &
  Partial<Pick<NormalizedThread, 'title' | 'workspace' | 'preview'>>

function emptySddThreadRegistry(): SddThreadRegistry {
  return { version: 1, drafts: {} }
}

function normalizeDraftId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ordered = new Set<string>()
  for (const item of value) {
    const threadId = normalizeThreadId(item)
    if (threadId) ordered.add(threadId)
  }
  return [...ordered].slice(0, MAX_SDD_THREAD_IDS_PER_DRAFT)
}

function publicThreadIdsForRecord(record: Pick<SddThreadRecord, 'publicThreadIds' | 'threadIds'>): Set<string> {
  const knownThreadIds = new Set(record.threadIds)
  return new Set(record.publicThreadIds.filter((threadId) => knownThreadIds.has(threadId)))
}

function hiddenThreadIdsForRecord(record: SddThreadRecord): string[] {
  const publicThreadIds = publicThreadIdsForRecord(record)
  return record.threadIds.filter((threadId) => !publicThreadIds.has(threadId))
}

function normalizeWorkspace(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
    : ''
}

function normalizeIsoText(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : new Date(0).toISOString()
}

function sddDraftKey(draft: Pick<SddDraft, 'id' | 'workspaceRoot' | 'relativePath'>): string {
  return draft.id.trim() ||
    `${normalizeWorkspace(draft.workspaceRoot)}:${draft.relativePath.trim()}`
}

function trimDraftRecords(
  drafts: SddThreadRegistry['drafts']
): SddThreadRegistry['drafts'] {
  return Object.fromEntries(
    Object.entries(drafts)
      .sort(([, left], [, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
      .slice(-MAX_SDD_THREAD_RECORDS)
  )
}

export function normalizeSddThreadRegistry(raw: unknown): SddThreadRegistry {
  if (!raw || typeof raw !== 'object') return emptySddThreadRegistry()
  const source = raw as { drafts?: unknown }
  if (!source.drafts || typeof source.drafts !== 'object') return emptySddThreadRegistry()

  const drafts: SddThreadRegistry['drafts'] = {}
  for (const [rawDraftId, value] of Object.entries(source.drafts as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const record = value as Partial<Record<keyof SddThreadRecord, unknown>>
    const draftId = normalizeDraftId(record.draftId) || normalizeDraftId(rawDraftId)
    const threadIds = normalizeThreadIds(record.threadIds)
    const threadId = normalizeThreadId(record.threadId) || (threadIds[0] ?? '')
    const rawPublicThreadIds = normalizeThreadIds(record.publicThreadIds)
    const workspaceRoot = normalizeWorkspace(record.workspaceRoot)
    if (!draftId || !threadId || !workspaceRoot) continue
    const allThreadIds = [
      threadId,
      ...threadIds.filter((id) => id !== threadId)
    ].slice(0, MAX_SDD_THREAD_IDS_PER_DRAFT)
    const publicThreadIds = rawPublicThreadIds.filter((id) => allThreadIds.includes(id))
    drafts[draftId] = {
      draftId,
      threadId: allThreadIds[0],
      threadIds: allThreadIds,
      publicThreadIds,
      workspaceRoot,
      updatedAt: normalizeIsoText(record.updatedAt)
    }
  }
  return { version: 1, drafts: trimDraftRecords(drafts) }
}

export function readSddThreadRegistry(
  storage: BrowserStorageLike | null = browserStorage()
): SddThreadRegistry {
  if (!storage) return emptySddThreadRegistry()
  try {
    const raw = storage.getItem(SDD_THREAD_REGISTRY_KEY)
    return normalizeSddThreadRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    return emptySddThreadRegistry()
  }
}

export function saveSddThreadRegistry(
  registry: SddThreadRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(SDD_THREAD_REGISTRY_KEY, JSON.stringify(normalizeSddThreadRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

export function markSddAssistantThread(
  draft: Pick<SddDraft, 'id' | 'workspaceRoot' | 'relativePath'>,
  threadId: string,
  storage: BrowserStorageLike | null = browserStorage()
): SddThreadRegistry {
  const normalizedThreadId = threadId.trim()
  const draftId = sddDraftKey(draft)
  const workspaceRoot = normalizeWorkspace(draft.workspaceRoot)
  const registry = readSddThreadRegistry(storage)
  if (!draftId || !normalizedThreadId || !workspaceRoot) return registry
  const previous = registry.drafts[draftId]
  const previousIds = previous?.threadIds ?? []
  const threadIds = [
    normalizedThreadId,
    ...previousIds.filter((id) => id !== normalizedThreadId)
  ].slice(0, MAX_SDD_THREAD_IDS_PER_DRAFT)
  const publicThreadIds =
    previous?.publicThreadIds.filter((id) => id !== normalizedThreadId && threadIds.includes(id)) ?? []
  const next: SddThreadRegistry = {
    version: 1,
    drafts: {
      ...registry.drafts,
      [draftId]: {
        draftId,
        threadId: normalizedThreadId,
        threadIds,
        publicThreadIds,
        workspaceRoot,
        updatedAt: new Date().toISOString()
      }
    }
  }
  saveSddThreadRegistry(next, storage)
  return normalizeSddThreadRegistry(next)
}

export function sddAssistantThreadIdForDraft(
  draft: Pick<SddDraft, 'id' | 'workspaceRoot' | 'relativePath'>,
  registry: SddThreadRegistry = readSddThreadRegistry()
): string {
  const draftId = sddDraftKey(draft)
  const record = registry.drafts[draftId]
  if (!record) return ''
  return hiddenThreadIdsForRecord(record).includes(record.threadId) ? record.threadId : ''
}

export function sddThreadIds(registry: SddThreadRegistry = readSddThreadRegistry()): Set<string> {
  const ids = new Set<string>()
  for (const record of Object.values(registry.drafts)) {
    for (const threadId of hiddenThreadIdsForRecord(record)) ids.add(threadId)
  }
  return ids
}

export function publicSddThreadIds(registry: SddThreadRegistry = readSddThreadRegistry()): Set<string> {
  const ids = new Set<string>()
  for (const record of Object.values(registry.drafts)) {
    for (const threadId of publicThreadIdsForRecord(record)) ids.add(threadId)
  }
  return ids
}

export function releaseSddAssistantThread(
  threadId: string,
  storage: BrowserStorageLike | null = browserStorage()
): boolean {
  const normalizedThreadId = normalizeThreadId(threadId)
  if (!normalizedThreadId) return false
  const registry = readSddThreadRegistry(storage)
  let changed = false
  const drafts: SddThreadRegistry['drafts'] = {}
  for (const [draftId, record] of Object.entries(registry.drafts)) {
    if (!record.threadIds.includes(normalizedThreadId)) {
      drafts[draftId] = record
      continue
    }
    const publicThreadIds = [
      normalizedThreadId,
      ...record.publicThreadIds.filter((id) => id !== normalizedThreadId)
    ].filter((id) => record.threadIds.includes(id))
    changed = changed || publicThreadIds.length !== record.publicThreadIds.length ||
      publicThreadIds.some((id, index) => id !== record.publicThreadIds[index])
    drafts[draftId] = {
      ...record,
      publicThreadIds,
      updatedAt: new Date().toISOString()
    }
  }
  if (!changed) return false
  saveSddThreadRegistry({ version: 1, drafts }, storage)
  return true
}

export function isSddAssistantThreadId(
  threadId: string | null | undefined,
  registry: SddThreadRegistry = readSddThreadRegistry()
): boolean {
  const id = threadId?.trim() ?? ''
  return Boolean(id && sddThreadIds(registry).has(id))
}

export function isSddAssistantThread(
  thread: SddThreadLike | null | undefined,
  registry: SddThreadRegistry = readSddThreadRegistry()
): boolean {
  if (!thread) return false
  if (publicSddThreadIds(registry).has(thread.id)) return false
  return isSddAssistantThreadId(thread.id, registry) || looksLikeLegacySddAssistantThread(thread)
}

function looksLikeLegacySddAssistantThread(thread: SddThreadLike): boolean {
  return [thread.workspace, thread.title, thread.preview].some((value) =>
    typeof value === 'string' && value.replaceAll('\\', '/').includes(SDD_DRAFT_PATH_FRAGMENT)
  )
}
