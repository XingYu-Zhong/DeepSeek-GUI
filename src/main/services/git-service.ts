import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitBranchesResult } from '../../shared/git-branches'
import { findNearestGitRoot } from './git-discovery'

const execFileAsync = promisify(execFile)

/**
 * Resolve a workspaceRoot to a directory that sits inside a Git working tree.
 *
 * `git rev-parse --show-toplevel` already walks up the directory tree, so it
 * usually finds the right cwd by itself. However, when the user's workspace
 * is set to a sub-folder of a repo AND the git binary is older than 2.28
 * (no `branch --format`) or returns an error string we don't match, the rest
 * of `getGitBranches` falls through to `gitFailure` and the UI shows
 * "未检测到 Git" even though we are clearly inside a repo. See issue #98.
 *
 * We mitigate that by walking up the tree in pure Node first and passing the
 * discovered repo root (or the original cwd if none was found) to git. This
 * is a defensive layer — when git itself works, the result is identical.
 */
async function resolveGitCwd(workspaceRoot: string): Promise<string> {
  const trimmed = workspaceRoot.trim()
  if (!trimmed) return trimmed
  const discovered = await findNearestGitRoot(trimmed)
  return discovered ?? trimmed
}

async function runGit(
  cwd: string,
  args: string[],
  timeout = 10_000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    // Force a C locale so git emits English diagnostics. gitFailure() matches
    // messages like "not a git repository"; without this, a localized git
    // (e.g. zh_CN: "不是 Git 仓库") falls through to a generic `error` reason
    // and the UI shows the wrong state instead of "not a Git repository".
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return { stdout: String(stdout), stderr: String(stderr) }
}

function gitFailure(error: unknown): GitBranchesResult {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

export async function getGitBranches(workspaceRoot: string): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const repositoryRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const currentRaw = (await runGit(cwd, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentRaw || null
    const branchLines = (await runGit(cwd, ['branch', '--format=%(refname:short)'])).stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const branchSet = new Set(branchLines)
    if (currentBranch && !branchSet.has(currentBranch)) branchSet.add(currentBranch)
    const branches = [...branchSet].map((name) => ({
      name,
      current: currentBranch === name
    }))
    const dirtyCount = (await runGit(cwd, ['status', '--porcelain=v1'])).stdout
      .split('\n')
      .filter((line) => line.trim().length > 0).length
    return { ok: true, repositoryRoot, currentBranch, branches, dirtyCount }
  } catch (error) {
    return gitFailure(error)
  }
}

export async function switchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    try {
      await runGit(cwd, ['switch', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}

export async function createAndSwitchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', branch])
    try {
      await runGit(cwd, ['switch', '-c', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', '-b', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}
