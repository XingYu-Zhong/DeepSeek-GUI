import { type Dirent } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorkspaceDirectoryTarget } from '../../shared/workspace-file'

export type ResolveTargetOptions = {
  allowBasenameFallback?: boolean
}

const SKIP_SEARCH_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'coverage'
])

export function expandHomePath(raw: string): string {
  const value = raw.trim()
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2))
  }
  return value
}

export function normalizeSkillFolderName(raw: string): string {
  const value = raw.trim()
  if (!value) {
    throw new Error('Skill name is required.')
  }
  if (value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error('Skill name cannot contain path separators.')
  }
  return value
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function sanitizeUserPath(raw: string): string {
  const value = raw.trim().replace(/\0/g, '')
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    return value.slice(1, -1).trim()
  }
  return value
}

export function normalizeUserPath(raw: string): string {
  const sanitized = sanitizeUserPath(raw)
  return process.platform === 'win32' ? sanitized : sanitized.replace(/\\/g, '/')
}

function hasPathSeparator(value: string): boolean {
  return /[\\/]/.test(value)
}

export function normalizePathSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

export function extensionFromName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function validateEntryName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error('Name is required.')
  }
  if (hasPathSeparator(trimmed) || basename(trimmed) !== trimmed) {
    throw new Error('Name must not contain path separators.')
  }
  return trimmed
}

function namesEqual(a: string, b: string): boolean {
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

async function findUniqueFileByBasename(root: string, fileName: string): Promise<string | null> {
  const matches: string[] = []
  const stack = [root]
  let scanned = 0

  while (stack.length > 0 && scanned < 12_000) {
    const current = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      scanned += 1
      if (entry.isDirectory()) {
        if (!SKIP_SEARCH_DIRS.has(entry.name)) {
          stack.push(join(current, entry.name))
        }
        continue
      }
      if (entry.isFile() && namesEqual(entry.name, fileName)) {
        matches.push(join(current, entry.name))
        if (matches.length > 1) return null
      }
    }
  }

  return matches[0] ?? null
}

export async function canonicalPath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath)
  } catch {
    return resolve(targetPath)
  }
}

function isWithinWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const rel = relative(workspaceRoot, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function enforceWorkspaceBoundary(targetPath: string, workspaceRoot?: string): Promise<string> {
  const rawWorkspace = workspaceRoot?.trim()
  if (!rawWorkspace) return targetPath

  const workspacePath = await canonicalPath(resolve(expandHomePath(rawWorkspace)))
  const canonicalTarget = await canonicalPath(targetPath)
  if (!isWithinWorkspace(workspacePath, canonicalTarget)) {
    throw new Error('Path must stay within the selected workspace.')
  }
  return canonicalTarget
}

export async function resolveTargetPathWithinWorkspace(rawPath: string, workspaceRoot?: string): Promise<string> {
  const value = normalizeUserPath(rawPath)
  if (!value) throw new Error('File path is required.')

  const expanded = expandHomePath(value)
  const rawWorkspace = workspaceRoot?.trim()
  if (!rawWorkspace) {
    return isAbsolute(expanded) ? resolve(expanded) : resolve(expanded)
  }

  const workspacePath = await canonicalPath(resolve(expandHomePath(rawWorkspace)))
  if (!isAbsolute(expanded)) {
    const direct = resolve(workspacePath, expanded)
    if (!isWithinWorkspace(workspacePath, direct)) {
      throw new Error('Path must stay within the selected workspace.')
    }
    return direct
  }

  const direct = resolve(expanded)
  if (isWithinWorkspace(workspacePath, direct)) {
    return direct
  }
  if (await pathExists(direct)) {
    const canonicalTarget = await canonicalPath(direct)
    if (isWithinWorkspace(workspacePath, canonicalTarget)) {
      return canonicalTarget
    }
  }
  throw new Error('Path must stay within the selected workspace.')
}

export async function resolveOpenTargetPath(
  rawPath: string,
  workspaceRoot?: string,
  options?: ResolveTargetOptions
): Promise<string> {
  const value = normalizeUserPath(rawPath)
  if (!value) throw new Error('File path is required.')

  const expanded = expandHomePath(value)
  const workspace = workspaceRoot?.trim() ? expandHomePath(workspaceRoot) : ''
  const allowBasenameFallback = options?.allowBasenameFallback ?? true
  const direct = isAbsolute(expanded)
    ? resolve(expanded)
    : workspace
      ? resolve(workspace, expanded)
      : resolve(expanded)

  if (await pathExists(direct)) {
    return enforceWorkspaceBoundary(direct, workspaceRoot)
  }

  if (allowBasenameFallback && workspace && !hasPathSeparator(expanded)) {
    const match = await findUniqueFileByBasename(resolve(workspace), expanded)
    if (match) {
      return enforceWorkspaceBoundary(match, workspaceRoot)
    }
  }

  throw new Error(`File not found: ${rawPath}`)
}

export async function resolveWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<string> {
  const workspaceRoot = payload.workspaceRoot.trim()
  if (!workspaceRoot) {
    throw new Error('Workspace root is required.')
  }

  const targetPath = payload.path?.trim()
    ? await resolveOpenTargetPath(payload.path, workspaceRoot, { allowBasenameFallback: false })
    : await canonicalPath(resolve(expandHomePath(workspaceRoot)))
  const info = await stat(targetPath)
  if (!info.isDirectory()) {
    throw new Error('Target path is not a directory.')
  }
  return targetPath
}

export function compareWorkspaceEntries(a: { type: 'file' | 'directory'; name: string }, b: { type: 'file' | 'directory'; name: string }): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}
