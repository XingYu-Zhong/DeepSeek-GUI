export type GitBranchRow = {
  name: string
  current: boolean
}

export type GitBranchesResult =
  | {
      ok: true
      repositoryRoot: string
      currentBranch: string | null
      branches: GitBranchRow[]
      dirtyCount: number
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }
