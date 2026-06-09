import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type {
  EditInstruction,
  FsStats,
  ImageDetection,
  ListEntry,
  ReadClassification,
  ResizedImageResult,
  ShellConfig,
  TruncateMode
} from './builtin-tool-types.js'
import { COMPACT_RESOURCE_FILE_NAMES } from './builtin-tool-types.js'

type SpawnSyncLike = typeof spawnSync
type SpawnLike = typeof spawn
const POWERSHELL_UTF8_OUTPUT_PREAMBLE = [
  '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = $OutputEncoding',
  'try { [Console]::InputEncoding = $OutputEncoding } catch {}'
].join('; ')

function firstLookupResult(
  lookup: SpawnSyncLike,
  command: string,
  args: string[]
): string {
  const result = lookup(command, args, { encoding: 'utf8' })
  return result.status === 0
    ? result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? ''
    : ''
}

export async function withToolBoundary(
  run: () => Promise<{ output: unknown; isError?: boolean }>
): Promise<{ output: unknown; isError?: boolean }> {
  try {
    return await run()
  } catch (error) {
    return {
      output: {
        error: error instanceof Error ? error.message : String(error)
      },
      isError: true
    }
  }
}

export function workspaceRoot(workspace: string): string {
  if (!workspace.trim()) return process.cwd()
  return isAbsolute(workspace) ? resolve(workspace) : resolve(process.cwd(), workspace)
}

export function resolveWorkspacePath(inputPath: string, context: ToolHostContext): {
  workspaceRoot: string
  absolutePath: string
  relativePath: string
} {
  const root = workspaceRoot(context.workspace)
  const absolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
  const relativePath = relative(root, absolutePath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`path escapes the workspace root: ${inputPath}`)
  }
  return {
    workspaceRoot: root,
    absolutePath,
    relativePath: relativePath || '.'
  }
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

export function detectImageMimeType(buffer: Buffer): ImageDetection | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (buffer.length >= 24) {
      return {
        mimeType: 'image/png',
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      }
    }
    return { mimeType: 'image/png' }
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3 && size >= 7) {
        return {
          mimeType: 'image/jpeg',
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        }
      }
      offset += 2 + size
    }
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') {
      if (buffer.length >= 10) {
        return {
          mimeType: 'image/gif',
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8)
        }
      }
      return { mimeType: 'image/gif' }
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    if (buffer.length >= 30 && buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
      return {
        mimeType: 'image/webp',
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      }
    }
    return { mimeType: 'image/webp' }
  }
  return null
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join('/')
}

export function getReadClassification(absolutePath: string, workspace: string): ReadClassification | undefined {
  const fileName = basename(absolutePath)
  if (fileName === 'SKILL.md') {
    return { kind: 'skill', label: basename(dirname(absolutePath)) || fileName }
  }
  if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
    return {
      kind: 'resource',
      label: toPosixPath(relative(workspaceRoot(workspace), absolutePath) || fileName)
    }
  }
  const relativePath = toPosixPath(relative(workspaceRoot(workspace), absolutePath))
  if (relativePath === 'README.md' || relativePath.startsWith('docs/') || relativePath.startsWith('examples/')) {
    return { kind: 'docs', label: relativePath }
  }
  return undefined
}

export function formatDimensionNote(image: ResizedImageResult): string | undefined {
  if (!image.wasResized || !image.originalWidth || !image.originalHeight) return undefined
  const scale = image.originalWidth / image.width
  return `[Image: original ${image.originalWidth}x${image.originalHeight}, displayed at ${image.width}x${image.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`
}

export function describeKind(mode: TruncateMode): string {
  return mode === 'head' ? 'first' : 'last'
}

export function shellConfig(
  platform: NodeJS.Platform = process.platform,
  lookup: SpawnSyncLike = spawnSync,
  fileExists: (path: string) => boolean = existsSync
): ShellConfig {
  if (platform === 'win32') {
    const pwsh = firstLookupResult(lookup, 'where', ['pwsh.exe'])
    if (pwsh) {
      return {
        shell: pwsh,
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']
      }
    }
    const powershell = firstLookupResult(lookup, 'where', ['powershell.exe'])
    if (powershell) {
      return {
        shell: powershell,
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']
      }
    }
    const bash = firstLookupResult(lookup, 'where', ['bash.exe'])
    if (bash) return { shell: bash, args: ['-lc'] }
    return { shell: 'cmd.exe', args: ['/d', '/s', '/c'] }
  }
  if (fileExists('/bin/bash')) return { shell: '/bin/bash', args: ['-lc'] }
  const candidate = firstLookupResult(lookup, 'which', ['bash'])
  if (candidate) return { shell: candidate, args: ['-lc'] }
  return { shell: 'sh', args: ['-lc'] }
}

export type ShellRuntimeInfo = ShellConfig & {
  name: string
  syntax: string
}

export function shellDisplayName(shell: string): string {
  const name = shell.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? shell.toLowerCase()
  if (name === 'cmd.exe') return 'cmd.exe'
  return name.endsWith('.exe') ? name.slice(0, -4) : name
}

export function shellRuntimeInfo(config: ShellConfig = shellConfig()): ShellRuntimeInfo {
  const name = shellDisplayName(config.shell)
  return {
    ...config,
    name,
    syntax: shellSyntaxHint(name)
  }
}

export function shellCommandArgs(config: ShellConfig, command: string): string[] {
  const name = shellDisplayName(config.shell)
  if (name === 'pwsh' || name === 'powershell') {
    const baseArgs = config.args.filter((arg) => arg.toLowerCase() !== '-command')
    const encodedCommand = Buffer.from(`${POWERSHELL_UTF8_OUTPUT_PREAMBLE}\n${command}`, 'utf16le')
      .toString('base64')
    return [...baseArgs, '-EncodedCommand', encodedCommand]
  }
  return [...config.args, command]
}

export function shellRuntimeInstruction(config: ShellConfig = shellConfig()): string {
  const shell = shellRuntimeInfo(config)
  return `Shell runtime: the \`bash\` tool executes commands with \`${shell.name}\` (${shell.shell}). Write shell commands appropriate for the host platform using ${shell.syntax} syntax. Do not assume POSIX/Bash syntax unless the current shell is Bash-compatible. Long-running commands may return a \`session_id\`; use \`bash\` with \`action: "poll"\` to read more output, \`action: "write"\` plus \`input\` to send stdin, or \`action: "stop"\` to terminate the process. For dev servers, start them normally, verify readiness once a URL or 200 response appears, then finish the user-facing answer without waiting for the server to exit.`
}

// `close` can be held open by background grandchildren that inherit stdio.
// Treat the shell's `exit` as command completion, then briefly flush output.
export async function waitForSpawnExit(
  child: ChildProcess,
  options: { flushAfterExitMs?: number } = {}
): Promise<number | null> {
  const flushAfterExitMs = options.flushAfterExitMs ?? 50
  let closeCode: number | null | undefined
  let closeSeen = false

  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code) => {
      closeSeen = true
      closeCode = code
      resolvePromise(code)
    })
    child.once('exit', (code) => {
      resolvePromise(code)
    })
  })

  if (!closeSeen && flushAfterExitMs > 0) {
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(resolvePromise, flushAfterExitMs)
      child.once('close', (code) => {
        closeSeen = true
        closeCode = code
        clearTimeout(timer)
        resolvePromise()
      })
    })
  }

  if (!closeSeen) {
    child.stdout?.destroy()
    child.stderr?.destroy()
  }

  return closeCode ?? exitCode
}

export function terminateSpawnTree(
  child: ChildProcess,
  options: {
    platform?: NodeJS.Platform
    signal?: NodeJS.Signals
    spawnImpl?: SpawnLike
  } = {}
): void {
  const signal = options.signal ?? 'SIGTERM'
  const pid = child.pid
  if (!pid) {
    child.kill(signal)
    return
  }

  if ((options.platform ?? process.platform) === 'win32') {
    try {
      const taskkill = (options.spawnImpl ?? spawn)('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
      taskkill.once('error', () => {
        child.kill(signal)
      })
      taskkill.unref?.()
      return
    } catch {
      child.kill(signal)
      return
    }
  }

  try {
    process.kill(-pid, signal)
    return
  } catch {
    child.kill(signal)
  }
}

function shellSyntaxHint(name: string): string {
  switch (name) {
    case 'bash':
    case 'sh':
    case 'zsh':
      return 'POSIX shell'
    case 'pwsh':
    case 'powershell':
      return 'PowerShell'
    case 'cmd.exe':
      return 'cmd.exe batch'
    default:
      return `${name} shell`
  }
}

export function resolveExecutable(
  candidates: string[],
  platform: NodeJS.Platform = process.platform,
  lookup: SpawnSyncLike = spawnSync,
  fileExists: (path: string) => boolean = existsSync,
  responds: (candidate: string) => boolean = executableResponds
): string | null {
  const lookupCommand = platform === 'win32' ? 'where' : 'which'
  for (const candidate of candidates) {
    const isExplicitPath = candidate.includes('/') || candidate.includes('\\')
    if (isExplicitPath && fileExists(candidate) && responds(candidate)) return candidate
    if (!isExplicitPath) {
      const resolved = firstLookupResult(lookup, lookupCommand, [candidate])
      if (resolved && responds(resolved)) return resolved
    }
  }
  return null
}

function executableResponds(candidate: string): boolean {
  const probe = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 1000
  })
  return !probe.error && probe.status === 0
}

export async function spawnCapture(
  file: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal }
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  let stdout = ''
  let stderr = ''
  const onAbort = () => terminateSpawnTree(child)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString()
  })
  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code) => resolvePromise(code))
  }).finally(() => {
    options.signal?.removeEventListener('abort', onAbort)
  })
  if (options.signal?.aborted) throw new Error('command aborted')
  return { stdout, stderr, exitCode }
}

export async function collectPaths(root: string, options: { includeDirectories?: boolean; limit: number }): Promise<string[]> {
  const results: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && results.length < options.limit) {
    const current = queue.shift()
    if (!current) break
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const next = join(current, entry.name)
      if (entry.isDirectory()) {
        if (options.includeDirectories) results.push(next)
        queue.push(next)
      } else {
        results.push(next)
      }
      if (results.length >= options.limit) break
    }
  }
  return results
}

export async function listDirectory(targetPath: string, root: string, recursive: boolean, limit: number): Promise<ListEntry[]> {
  const targetStat = await stat(targetPath)
  if (!targetStat.isDirectory()) {
    return [makeListEntry(targetPath, root, targetStat)]
  }
  if (!recursive) {
    const entries = await readdir(targetPath, { withFileTypes: true })
    const sliced = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
    const result: ListEntry[] = []
    for (const entry of sliced) {
      const entryPath = join(targetPath, entry.name)
      result.push(makeListEntry(entryPath, root, await stat(entryPath)))
    }
    return result
  }

  const paths = await collectPaths(targetPath, { includeDirectories: true, limit })
  const result: ListEntry[] = []
  for (const filePath of paths) {
    result.push(makeListEntry(filePath, root, await stat(filePath)))
  }
  return result
}

export async function listDirectoryWithOps(
  targetPath: string,
  root: string,
  recursive: boolean,
  limit: number,
  statOp: (path: string) => Promise<FsStats>,
  readdirOp: (path: string) => Promise<Array<{ name: string }>>
): Promise<ListEntry[]> {
  const targetStat = await statOp(targetPath)
  if (!targetStat.isDirectory()) {
    return [makeListEntry(targetPath, root, targetStat)]
  }
  if (!recursive) {
    const entries = await readdirOp(targetPath)
    const sliced = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
    const result: ListEntry[] = []
    for (const entry of sliced) {
      const entryPath = join(targetPath, entry.name)
      result.push(makeListEntry(entryPath, root, await statOp(entryPath)))
    }
    return result
  }
  return listDirectory(targetPath, root, recursive, limit)
}

export function makeListEntry(path: string, root: string, fileStat: FsStats): ListEntry {
  return {
    path,
    relative_path: normalizeToolPath(relative(root, path) || '.'),
    name: basename(path),
    kind: fileStat.isDirectory()
      ? 'directory'
      : fileStat.isFile()
        ? 'file'
        : fileStat.isSymbolicLink()
          ? 'symlink'
          : 'other',
    size: Number(fileStat.size)
  }
}

export function compilePattern(pattern: string, literal: boolean): RegExp {
  if (literal) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'i')
  }
  return new RegExp(pattern, 'i')
}

export function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function globToRegExp(pattern: string): RegExp {
  const optionalPrefix = pattern.startsWith('**/')
  const normalizedPattern = optionalPrefix ? pattern.slice(3) : pattern
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withWildcards = escaped
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/::DOUBLE_STAR::/g, '.*')
  return new RegExp(`^${optionalPrefix ? '(?:.*/)?' : ''}${withWildcards}$`, 'i')
}

export function normalizeToolPath(value: string): string {
  return value.replace(/\\/g, '/').split(sep).join('/')
}

export function parseEditInstructions(args: Record<string, unknown>): EditInstruction[] {
  if (Array.isArray(args.edits)) {
    const edits = args.edits
      .map((value) => {
        if (!value || typeof value !== 'object') return null
        const raw = value as Record<string, unknown>
        return typeof raw.oldText === 'string' && typeof raw.newText === 'string'
          ? { oldText: raw.oldText, newText: raw.newText }
          : null
      })
      .filter((value): value is EditInstruction => value !== null)
    if (edits.length > 0) return edits
  }
  return typeof args.oldText === 'string' && typeof args.newText === 'string'
    ? [{ oldText: args.oldText, newText: args.newText }]
    : []
}

export function findOccurrences(source: string, needle: string): number[] {
  const matches: number[] = []
  if (!needle) return matches
  let index = 0
  while (true) {
    const next = source.indexOf(needle, index)
    if (next === -1) return matches
    matches.push(next)
    index = next + Math.max(1, needle.length)
  }
}

export function applyExactTextEdits(
  source: string,
  edits: EditInstruction[]
): { next: string; replacements: number } {
  const planned = edits.map((edit, index) => {
    const matches = findOccurrences(source, edit.oldText)
    if (matches.length === 0) {
      throw new Error(`edits[${index}].oldText was not found in the target file`)
    }
    if (matches.length > 1) {
      throw new Error(`edits[${index}].oldText matched ${matches.length} locations; each edit must be unique in the original file`)
    }
    return {
      start: matches[0]!,
      end: matches[0]! + edit.oldText.length,
      newText: edit.newText
    }
  })

  const sorted = [...planned].sort((a, b) => a.start - b.start)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (current.start < previous.end) {
      throw new Error('edit ranges overlap in the original file; merge nearby changes into one edit')
    }
  }

  let next = source
  for (const patch of [...sorted].sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, patch.start)}${patch.newText}${next.slice(patch.end)}`
  }
  return { next, replacements: sorted.length }
}
