import { jsonResponse, type JsonResponse } from '../response.js'
import type { WorkspaceInspector } from '../../ports/workspace-inspector.js'

/**
 * Build the `GET /v1/workspace/status` response. The path comes from
 * the `?path=` query string and falls back to an empty status when
 * the caller does not provide one.
 */
export function buildWorkspaceStatusResponse(input: {
  inspector: WorkspaceInspector
  path: string | null
}): Promise<JsonResponse> {
  if (!input.path) {
    return Promise.resolve(
      jsonResponse({
        path: '',
        exists: false,
        isGitRepository: false,
        branch: null,
        headSha: null,
        isDirty: null,
        fileChangeCount: null,
        checkedAt: new Date().toISOString()
      })
    )
  }
  return input.inspector.status(input.path).then((status) => jsonResponse(status))
}
