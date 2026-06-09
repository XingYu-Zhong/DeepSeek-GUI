import type { WorkspaceFileTarget } from '@shared/workspace-file'

export const WORKSPACE_FILE_PREVIEW_EVENT = 'deepseekgui:workspace-file-preview'

export type WorkspaceFilePreviewDetail = WorkspaceFileTarget

export function previewWorkspaceFile(target: WorkspaceFilePreviewDetail): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceFilePreviewDetail>(WORKSPACE_FILE_PREVIEW_EVENT, {
      detail: target
    })
  )
}
