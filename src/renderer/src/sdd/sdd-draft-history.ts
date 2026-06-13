import {
  SDD_DRAFT_FILE_NAME,
  SDD_REQUIREMENTS_RELATIVE_DIR,
  buildSddDraftRelativePath,
  isSddDraftRelativePath,
  normalizeSddRelativePath
} from '@shared/sdd'
import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceFileReadResult,
  WorkspaceFileTarget
} from '@shared/workspace-file'
import {
  buildSddDraftId,
  readRememberedSddDraftContent,
  readRememberedSddDrafts,
  type SddDraft
} from './sdd-draft-store'

export type SddDraftHistoryItem = SddDraft & {
  title: string
  searchText?: string
  source: 'remembered' | 'disk'
}

type ListSddDraftHistoryOptions = {
  workspaceRoot: string
  listWorkspaceDirectory: (options: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  limit?: number
}

const DEFAULT_HISTORY_LIMIT = 40

function normalizeWorkspaceRoot(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function titleFromSddDraftContent(content: string, fallback: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/\s*\{(?:draft|planned|building|done|verified)\}\s*$/i, '').trim())
    .find(Boolean)
  return (heading || fallback).slice(0, 120)
}

function fallbackTitleForPath(relativePath: string): string {
  const parts = normalizeSddRelativePath(relativePath).split('/').filter(Boolean)
  return parts.at(-2) || SDD_DRAFT_FILE_NAME
}

async function readDraftTitle(
  draft: SddDraft,
  readWorkspaceFile: ListSddDraftHistoryOptions['readWorkspaceFile']
): Promise<{ title: string, absolutePath?: string, searchText?: string }> {
  const snapshot = readRememberedSddDraftContent(draft)
  if (snapshot?.content) {
    return {
      title: titleFromSddDraftContent(snapshot.content, fallbackTitleForPath(draft.relativePath)),
      searchText: snapshot.content
    }
  }

  const result = await readWorkspaceFile({
    workspaceRoot: draft.workspaceRoot,
    path: draft.relativePath
  })
  if (!result.ok) {
    return { title: fallbackTitleForPath(draft.relativePath) }
  }
  return {
    title: titleFromSddDraftContent(result.content, fallbackTitleForPath(draft.relativePath)),
    absolutePath: result.path,
    searchText: result.content
  }
}

async function discoverDiskDrafts({
  workspaceRoot,
  listWorkspaceDirectory,
  limit = DEFAULT_HISTORY_LIMIT
}: Pick<ListSddDraftHistoryOptions, 'workspaceRoot' | 'listWorkspaceDirectory' | 'limit'>): Promise<SddDraft[]> {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return []

  const root = await listWorkspaceDirectory({
    workspaceRoot: normalizedWorkspace,
    path: SDD_REQUIREMENTS_RELATIVE_DIR
  })
  if (!root.ok) return []

  const drafts: SddDraft[] = []
  for (const entry of root.entries) {
    if (entry.type !== 'directory') continue
    const relativePath = buildSddDraftRelativePath(entry.name)
    if (!isSddDraftRelativePath(relativePath)) continue

    const folder = await listWorkspaceDirectory({
      workspaceRoot: normalizedWorkspace,
      path: `${SDD_REQUIREMENTS_RELATIVE_DIR}/${entry.name}`
    })
    if (!folder.ok) continue
    const requirement = folder.entries.find((item) => item.type === 'file' && item.name === SDD_DRAFT_FILE_NAME)
    if (!requirement) continue

    drafts.push({
      id: buildSddDraftId(normalizedWorkspace, relativePath),
      workspaceRoot: normalizedWorkspace,
      relativePath,
      absolutePath: requirement.path,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    })
    if (drafts.length >= limit) break
  }
  return drafts
}

export async function listSddDraftHistory({
  workspaceRoot,
  listWorkspaceDirectory,
  readWorkspaceFile,
  limit = DEFAULT_HISTORY_LIMIT
}: ListSddDraftHistoryOptions): Promise<SddDraftHistoryItem[]> {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return []

  const remembered = readRememberedSddDrafts(normalizedWorkspace).slice(0, limit)
  const diskDrafts = await discoverDiskDrafts({ workspaceRoot: normalizedWorkspace, listWorkspaceDirectory, limit })
  const merged = new Map<string, SddDraft & { source: 'remembered' | 'disk' }>()

  for (const draft of remembered) {
    merged.set(draft.id, { ...draft, source: 'remembered' })
  }
  for (const draft of diskDrafts) {
    const previous = merged.get(draft.id)
    merged.set(draft.id, {
      ...draft,
      ...previous,
      absolutePath: previous?.absolutePath ?? draft.absolutePath,
      source: previous?.source ?? 'disk'
    })
  }

  const items = await Promise.all(
    [...merged.values()].map(async (draft) => {
      const title = await readDraftTitle(draft, readWorkspaceFile)
      return {
        ...draft,
        absolutePath: title.absolutePath ?? draft.absolutePath,
        ...(title.searchText ? { searchText: title.searchText } : {}),
        title: title.title
      }
    })
  )

  return items
    .sort((a, b) => {
      const byTime = timestampMs(b.updatedAt) - timestampMs(a.updatedAt)
      if (byTime !== 0) return byTime
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    })
    .slice(0, limit)
}
