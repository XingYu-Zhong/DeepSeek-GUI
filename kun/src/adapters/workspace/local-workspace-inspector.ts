import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkspaceInspector } from '../../ports/workspace-inspector.js'
import type { WorkspaceStatus } from '../../contracts/workspace.js'
import { systemClock } from '../../ports/clock.js'

const execFileAsync = promisify(execFile)

/**
 * Local workspace inspector. The implementation shells out to `git`
 * (when present) to report branch, head SHA, and dirtiness. The
 * inspector never mutates the workspace.
 */
export class LocalWorkspaceInspector implements WorkspaceInspector {
  private readonly exec: (
    file: string,
    args: string[]
  ) => Promise<{ stdout: string; stderr: string }>

  constructor(
    options: {
      exec?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
    } = {}
  ) {
    this.exec = options.exec ?? execFileAsync
  }

  async status(workspace: string): Promise<WorkspaceStatus> {
    const abs = resolve(workspace)
    const exists = existsSync(abs)
    if (!exists) {
      return {
        path: abs,
        exists: false,
        isGitRepository: false,
        branch: null,
        headSha: null,
        isDirty: null,
        fileChangeCount: null,
        checkedAt: systemClock.nowIso()
      }
    }
    const inside = await this.isInsideGitRepository(abs)
    if (!inside) {
      return {
        path: abs,
        exists: true,
        isGitRepository: false,
        branch: null,
        headSha: null,
        isDirty: null,
        fileChangeCount: null,
        checkedAt: systemClock.nowIso()
      }
    }
    const branch = await this.runGit(abs, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null)
    const head = await this.runGit(abs, ['rev-parse', 'HEAD']).catch(() => null)
    const statusOutput = await this.runGit(abs, ['status', '--porcelain']).catch(() => null)
    const fileChangeCount = statusOutput ? statusOutput.split('\n').filter(Boolean).length : 0
    const isDirty = fileChangeCount > 0
    return {
      path: abs,
      exists: true,
      isGitRepository: true,
      branch,
      headSha: head,
      isDirty,
      fileChangeCount,
      checkedAt: systemClock.nowIso()
    }
  }

  private async isInsideGitRepository(workspace: string): Promise<boolean> {
    const result = await this.runGit(workspace, ['rev-parse', '--is-inside-work-tree']).catch(
      () => null
    )
    return result === 'true'
  }

  private async runGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await this.exec('git', args)
    return stdout.trim()
  }
}
