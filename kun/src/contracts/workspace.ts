import { z } from 'zod'

/**
 * Workspace status returned on `GET /v1/workspace/status`. All fields are
 * best-effort: when Kun is not running inside a git repository, the
 * git-related entries are reported as `null`.
 */
export const WorkspaceStatusSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  isGitRepository: z.boolean(),
  branch: z.string().nullable(),
  headSha: z.string().nullable(),
  isDirty: z.boolean().nullable(),
  fileChangeCount: z.number().int().nonnegative().nullable(),
  checkedAt: z.string()
})
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>
