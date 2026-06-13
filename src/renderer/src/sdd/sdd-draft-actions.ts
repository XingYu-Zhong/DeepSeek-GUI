import { sddRequirementUnitDir } from '@shared/sdd'
import {
  forgetRememberedSddDraft,
  useSddDraftStore,
  type SddDraft
} from './sdd-draft-store'

type SddDraftDiskSnapshot = {
  path?: string
  content?: string
  size?: number
  truncated?: boolean
  message?: string
}

export type DeleteSddDraftResult =
  | { ok: true }
  | { ok: false; message: string }

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function snapshotMatchesActiveDraft(path: string): boolean {
  const draft = useSddDraftStore.getState().activeDraft
  if (!draft) return false
  const normalized = normalizePath(path)
  const relativePath = normalizePath(draft.relativePath)
  const candidates = [
    draft.absolutePath,
    draft.relativePath,
    `${draft.workspaceRoot}/${draft.relativePath}`
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizePath)
  return candidates.includes(normalized) || normalized.endsWith(`/${relativePath}`)
}

function isMissingWorkspaceEntryMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent') ||
    normalized.includes('no such file') ||
    normalized.includes('not found')
}

export async function syncActiveSddDraftFromDisk(snapshot: SddDraftDiskSnapshot): Promise<boolean> {
  const state = useSddDraftStore.getState()
  const draft = state.activeDraft
  if (!draft) return false
  if (state.saveStatus === 'dirty' || state.saveStatus === 'saving') return false
  if (snapshot.path && !snapshotMatchesActiveDraft(snapshot.path)) return false

  if (snapshot.message) {
    useSddDraftStore.getState().setSaveStatus('error', snapshot.message)
    return false
  }

  let content = snapshot.content
  if (typeof content !== 'string') {
    const result = await window.kunGui.readWorkspaceFile({
      workspaceRoot: draft.workspaceRoot,
      path: draft.relativePath
    })
    if (!result.ok) {
      useSddDraftStore.getState().setSaveStatus('error', result.message)
      return false
    }
    content = result.content
  }

  const latest = useSddDraftStore.getState()
  if (latest.activeDraft?.id !== draft.id) return false
  if (latest.saveStatus === 'dirty' || latest.saveStatus === 'saving') return false

  latest.markSaved(content)
  return true
}

export async function saveActiveSddDraftToDisk(): Promise<boolean> {
  const snapshot = useSddDraftStore.getState()
  const draft = snapshot.activeDraft
  if (!draft) return true
  if (snapshot.saveStatus === 'saved' && snapshot.content === snapshot.lastSavedContent) return true

  useSddDraftStore.getState().setSaveStatus('saving')
  try {
    const result = await window.kunGui.writeWorkspaceFile({
      workspaceRoot: draft.workspaceRoot,
      path: draft.relativePath,
      content: snapshot.content
    })
    if (!result.ok) {
      useSddDraftStore.getState().setSaveStatus('error', result.message)
      return false
    }
    const latest = useSddDraftStore.getState()
    if (latest.activeDraft?.id === draft.id) {
      latest.markSaved(snapshot.content)
    }
    return true
  } catch (error) {
    useSddDraftStore.getState().setSaveStatus(
      'error',
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

export async function deleteSddDraft(draft: SddDraft): Promise<DeleteSddDraftResult> {
  // Removing the unit directory takes the markdown, trace, images,
  // prototypes and chat records with it in one pass.
  const folderPath = sddRequirementUnitDir(draft.relativePath)
  if (!folderPath) return { ok: false, message: 'Invalid requirement draft path.' }
  if (typeof window.kunGui?.deleteWorkspaceEntry !== 'function') {
    return { ok: false, message: 'Deleting requirement drafts is not available.' }
  }

  try {
    const result = await window.kunGui.deleteWorkspaceEntry({
      workspaceRoot: draft.workspaceRoot,
      path: folderPath
    })
    if (!result.ok && !isMissingWorkspaceEntryMessage(result.message)) {
      return { ok: false, message: result.message }
    }
    forgetRememberedSddDraft(draft)
    if (useSddDraftStore.getState().activeDraft?.id === draft.id) {
      useSddDraftStore.getState().clearActiveDraft()
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
