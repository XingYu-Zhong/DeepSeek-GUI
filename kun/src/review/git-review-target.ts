import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { ReviewTarget } from '../contracts/review.js'

const execFileAsync = promisify(execFile)
const DEFAULT_DIFF_MAX_BYTES = 256 * 1024
const GIT_COMMAND_TIMEOUT_MS = 10_000
const GIT_COMMAND_MAX_BUFFER = 384 * 1024

export type ResolvedReviewPrompt = {
  title: string
  prompt: string
}

export type ResolveReviewTargetOptions = {
  target: ReviewTarget
  workspace: string
  maxDiffBytes?: number
}

export async function resolveReviewTargetPrompt(
  options: ResolveReviewTargetOptions
): Promise<ResolvedReviewPrompt> {
  const workspace = normalizeWorkspace(options.workspace)
  const maxDiffBytes = options.maxDiffBytes ?? DEFAULT_DIFF_MAX_BYTES
  if (options.target.kind === 'custom') {
    return {
      title: 'Custom code review',
      prompt: buildPrompt({
        workspace,
        title: 'Custom code review',
        body: [
          'The user supplied custom review instructions.',
          '',
          '<custom_instructions>',
          options.target.instructions,
          '</custom_instructions>'
        ].join('\n')
      }, maxDiffBytes)
    }
  }

  await assertGitWorkspace(workspace)
  switch (options.target.kind) {
    case 'uncommittedChanges':
      return resolveUncommittedChanges(workspace, maxDiffBytes)
    case 'baseBranch':
      return resolveBaseBranch(workspace, options.target.branch, maxDiffBytes)
    case 'commit':
      return resolveCommit(workspace, options.target.sha, maxDiffBytes)
  }
}

async function resolveUncommittedChanges(
  workspace: string,
  maxDiffBytes: number
): Promise<ResolvedReviewPrompt> {
  const [status, staged, unstaged, untracked] = await Promise.all([
    runGit(workspace, ['status', '--short']),
    runGit(workspace, ['diff', '--cached', '--stat', '--patch', '--find-renames']),
    runGit(workspace, ['diff', '--stat', '--patch', '--find-renames']),
    runGit(workspace, ['ls-files', '--others', '--exclude-standard'])
  ])
  return {
    title: 'Review current changes',
    prompt: buildPrompt({
      workspace,
      title: 'Review current changes',
      body: [
        'Review the current code changes, including staged, unstaged, and untracked files.',
        '',
        '<git_status_short>',
        status.stdout || '(clean)',
        '</git_status_short>',
        '',
        '<staged_diff>',
        staged.stdout || '(no staged diff)',
        '</staged_diff>',
        '',
        '<unstaged_diff>',
        unstaged.stdout || '(no unstaged diff)',
        '</unstaged_diff>',
        '',
        '<untracked_files>',
        untracked.stdout || '(no untracked files)',
        '</untracked_files>'
      ].join('\n')
    }, maxDiffBytes)
  }
}

async function resolveBaseBranch(
  workspace: string,
  branch: string,
  maxDiffBytes: number
): Promise<ResolvedReviewPrompt> {
  const normalizedBranch = branch.trim()
  if (!normalizedBranch) throw new Error('base branch is required')
  const mergeBase = (await runGit(workspace, ['merge-base', 'HEAD', normalizedBranch])).stdout.trim()
  if (!mergeBase) throw new Error(`could not resolve merge-base with ${normalizedBranch}`)
  const diff = await runGit(workspace, ['diff', '--stat', '--patch', '--find-renames', mergeBase])
  return {
    title: `Review changes against ${normalizedBranch}`,
    prompt: buildPrompt({
      workspace,
      title: `Review changes against ${normalizedBranch}`,
      body: [
        `Review the code changes from merge-base ${mergeBase} against branch ${normalizedBranch}.`,
        '',
        '<git_diff>',
        diff.stdout || '(no diff)',
        '</git_diff>'
      ].join('\n')
    }, maxDiffBytes)
  }
}

async function resolveCommit(
  workspace: string,
  sha: string,
  maxDiffBytes: number
): Promise<ResolvedReviewPrompt> {
  const normalizedSha = sha.trim()
  if (!normalizedSha) throw new Error('commit sha is required')
  const show = await runGit(workspace, [
    'show',
    '--stat',
    '--patch',
    '--find-renames',
    '--format=fuller',
    normalizedSha
  ])
  return {
    title: `Review commit ${normalizedSha.slice(0, 12)}`,
    prompt: buildPrompt({
      workspace,
      title: `Review commit ${normalizedSha}`,
      body: [
        `Review commit ${normalizedSha}.`,
        '',
        '<git_show>',
        show.stdout || '(no commit output)',
        '</git_show>'
      ].join('\n')
    }, maxDiffBytes)
  }
}

async function assertGitWorkspace(workspace: string): Promise<void> {
  await runGit(workspace, ['rev-parse', '--show-toplevel'])
}

async function runGit(
  cwd: string,
  args: readonly string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER
    })
    return {
      stdout: normalizeOutput(result.stdout),
      stderr: normalizeOutput(result.stderr)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const withOutput = error && typeof error === 'object'
      ? error as { stdout?: unknown; stderr?: unknown }
      : {}
    const stderr = normalizeOutput(withOutput.stderr)
    const stdout = normalizeOutput(withOutput.stdout)
    throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout || message}`)
  }
}

function buildPrompt(
  input: { workspace: string; title: string; body: string },
  maxDiffBytes: number
): string {
  const raw = [
    input.title,
    '',
    `Workspace: ${input.workspace}`,
    '',
    input.body,
    '',
    'Review instructions:',
    '- Inspect the supplied diff and use read-only tools if you need more context.',
    '- Report only concrete bugs introduced by the reviewed change.',
    '- Return the strict JSON shape required by the system prompt.'
  ].join('\n')
  return truncateUtf8(raw, maxDiffBytes)
}

function normalizeWorkspace(workspace: string): string {
  const trimmed = workspace.trim()
  if (!trimmed || trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

function normalizeOutput(value: unknown): string {
  if (typeof value === 'string') return value.trimEnd()
  if (Buffer.isBuffer(value)) return value.toString('utf8').trimEnd()
  return ''
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= maxBytes) return text
  const truncated = bytes.subarray(0, maxBytes).toString('utf8')
  return [
    truncated,
    '',
    `[Review input truncated to ${maxBytes} bytes. Use read-only tools to inspect omitted context.]`
  ].join('\n')
}
