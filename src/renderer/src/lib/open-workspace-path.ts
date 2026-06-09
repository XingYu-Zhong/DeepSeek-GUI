import type { EditorOpenResult } from '@shared/editor'
import { readPreferredEditorId } from './editor-preferences'

export type WorkspacePathTarget = {
  path: string
  line?: number
  column?: number
}

export async function openWorkspacePathInEditor(
  target: WorkspacePathTarget,
  workspaceRoot?: string
): Promise<EditorOpenResult> {
  if (typeof window === 'undefined' || typeof window.dsGui?.openEditorPath !== 'function') {
    return { ok: false, message: 'Editor bridge is unavailable.' }
  }

  try {
    return await window.dsGui.openEditorPath({
      path: target.path,
      line: target.line,
      column: target.column,
      workspaceRoot,
      editorId: readPreferredEditorId()
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const openWorkspacePath = openWorkspacePathInEditor
