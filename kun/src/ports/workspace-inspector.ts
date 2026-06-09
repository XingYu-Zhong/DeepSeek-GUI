import type { WorkspaceStatus } from '../contracts/workspace.js'

/**
 * Port for inspecting the local workspace of a thread. The default
 * implementation reads git status when available and reports `null`
 * fields when the workspace is not a git repository.
 */
export interface WorkspaceInspector {
  status(workspace: string): Promise<WorkspaceStatus>
}
