import { useSddDraftStore } from './sdd-draft-store'

export async function saveActiveSddDraftToDisk(): Promise<boolean> {
  const snapshot = useSddDraftStore.getState()
  const draft = snapshot.activeDraft
  if (!draft) return true
  if (snapshot.saveStatus === 'saved' && snapshot.content === snapshot.lastSavedContent) return true

  useSddDraftStore.getState().setSaveStatus('saving')
  try {
    const result = await window.dsGui.writeWorkspaceFile({
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
