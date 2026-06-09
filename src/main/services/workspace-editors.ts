import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, stat, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  EditorInfo,
  EditorListResult,
  EditorOpenResult,
  OpenEditorPathOptions
} from '../../shared/editor'
import { pathExists, resolveOpenTargetPath } from './workspace-paths'

const execFileAsync = promisify(execFile)

type EditorLineStyle = 'vscode' | 'xcode' | 'sublime' | 'zed'

type EditorCandidate = {
  id: string
  label: string
  kind: EditorInfo['kind']
  commands?: string[]
  commonCommandPaths?: string[]
  macAppName?: string
  macAppPaths?: string[]
  winAppPaths?: string[]
  lineStyle?: EditorLineStyle
  alwaysAvailable?: boolean
  openDirectory?: boolean
  platforms?: NodeJS.Platform[]
}

type ResolvedEditor = EditorInfo & {
  command?: string
  macAppName?: string
  appPath?: string
  lineStyle?: EditorLineStyle
  openDirectory?: boolean
}

const DEFAULT_EDITOR_ID = 'system'
const EDITOR_ICON_PX = 18

const EDITOR_CANDIDATES: EditorCandidate[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    kind: 'editor',
    commands: ['code'],
    commonCommandPaths: [
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    ],
    macAppName: 'Visual Studio Code',
    macAppPaths: [
      '/Applications/Visual Studio Code.app',
      join(homedir(), 'Applications/Visual Studio Code.app')
    ],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Microsoft VS Code', 'Code.exe')
    ],
    lineStyle: 'vscode'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    kind: 'editor',
    commands: ['cursor'],
    commonCommandPaths: [
      '/usr/local/bin/cursor',
      '/opt/homebrew/bin/cursor',
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'
    ],
    macAppName: 'Cursor',
    macAppPaths: ['/Applications/Cursor.app', join(homedir(), 'Applications/Cursor.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cursor', 'Cursor.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Cursor', 'Cursor.exe')
    ],
    lineStyle: 'vscode'
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    kind: 'editor',
    commands: ['windsurf'],
    commonCommandPaths: [
      '/usr/local/bin/windsurf',
      '/opt/homebrew/bin/windsurf',
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'
    ],
    macAppName: 'Windsurf',
    macAppPaths: ['/Applications/Windsurf.app', join(homedir(), 'Applications/Windsurf.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Windsurf', 'Windsurf.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Windsurf', 'Windsurf.exe')
    ],
    lineStyle: 'vscode'
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    kind: 'editor',
    commands: ['antigravity'],
    commonCommandPaths: [
      '/usr/local/bin/antigravity',
      '/opt/homebrew/bin/antigravity',
      '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity'
    ],
    macAppName: 'Antigravity',
    macAppPaths: ['/Applications/Antigravity.app', join(homedir(), 'Applications/Antigravity.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity', 'Antigravity.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Antigravity', 'Antigravity.exe')
    ],
    lineStyle: 'vscode'
  },
  {
    id: 'zed',
    label: 'Zed',
    kind: 'editor',
    commands: ['zed'],
    commonCommandPaths: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'],
    macAppName: 'Zed',
    macAppPaths: ['/Applications/Zed.app', join(homedir(), 'Applications/Zed.app')],
    lineStyle: 'zed'
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    kind: 'editor',
    commands: ['subl', 'sublime_text'],
    commonCommandPaths: ['/usr/local/bin/subl', '/opt/homebrew/bin/subl'],
    macAppName: 'Sublime Text',
    macAppPaths: [
      '/Applications/Sublime Text.app',
      join(homedir(), 'Applications/Sublime Text.app')
    ],
    lineStyle: 'sublime'
  },
  {
    id: 'xcode',
    label: 'Xcode',
    kind: 'editor',
    commands: ['xed'],
    commonCommandPaths: ['/usr/bin/xed'],
    macAppName: 'Xcode',
    macAppPaths: ['/Applications/Xcode.app', join(homedir(), 'Applications/Xcode.app')],
    lineStyle: 'xcode',
    platforms: ['darwin']
  },
  {
    id: 'finder',
    label: 'Finder',
    kind: 'viewer',
    alwaysAvailable: true,
    macAppName: 'Finder',
    macAppPaths: ['/System/Library/CoreServices/Finder.app'],
    platforms: ['darwin']
  },
  {
    id: 'terminal',
    label: 'Terminal',
    kind: 'terminal',
    alwaysAvailable: true,
    macAppName: 'Terminal',
    macAppPaths: ['/System/Applications/Utilities/Terminal.app'],
    openDirectory: true,
    platforms: ['darwin']
  },
  {
    id: 'ghostty',
    label: 'Ghostty',
    kind: 'terminal',
    commands: ['ghostty'],
    commonCommandPaths: ['/usr/local/bin/ghostty', '/opt/homebrew/bin/ghostty'],
    macAppName: 'Ghostty',
    macAppPaths: ['/Applications/Ghostty.app', join(homedir(), 'Applications/Ghostty.app')],
    openDirectory: true
  },
  {
    id: 'system',
    label: 'System default',
    kind: 'viewer',
    alwaysAvailable: true
  }
]

export async function openPathWithShell(targetPath: string): Promise<{ ok: boolean; message?: string }> {
  const result = await shell.openPath(targetPath)
  return result ? { ok: false, message: result } : { ok: true }
}

function candidateSupportsPlatform(candidate: EditorCandidate): boolean {
  return !candidate.platforms || candidate.platforms.includes(process.platform)
}

function compactPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path?.trim()))
}

function commandPathGuesses(command: string): string[] {
  if (!command || command.includes('/') || command.includes('\\')) return [command]
  if (process.platform === 'win32') {
    return [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', command, `${command}.exe`),
      join(process.env.PROGRAMFILES ?? '', command, `${command}.exe`)
    ]
  }
  return [`/usr/local/bin/${command}`, `/opt/homebrew/bin/${command}`, `/usr/bin/${command}`]
}

async function findExecutable(commands: string[] = [], commonPaths: string[] = []): Promise<string | undefined> {
  const candidates = compactPaths([
    ...commonPaths,
    ...commands.flatMap((command) => commandPathGuesses(command))
  ])
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which'
  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(lookup, [command], {
        timeout: 1500,
        windowsHide: true
      })
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (first) return first
    } catch {
      /* command is not on PATH */
    }
  }

  return undefined
}

async function findFirstExistingPath(paths: string[] = []): Promise<string | undefined> {
  for (const candidate of compactPaths(paths)) {
    if (await pathExists(candidate)) return candidate
  }
  return undefined
}

async function resolveEditor(candidate: EditorCandidate): Promise<ResolvedEditor | null> {
  if (!candidateSupportsPlatform(candidate)) return null

  const command = await findExecutable(candidate.commands, [
    ...(candidate.commonCommandPaths ?? []),
    ...(process.platform === 'win32' ? candidate.winAppPaths ?? [] : [])
  ])
  const macAppPath =
    process.platform === 'darwin'
      ? await findFirstExistingPath(candidate.macAppPaths)
      : undefined
  const available = Boolean(candidate.alwaysAvailable || command || macAppPath)
  if (!available) return null

  return {
    id: candidate.id,
    label: candidate.label,
    kind: candidate.kind,
    available: true,
    supportsLine: Boolean(command && candidate.lineStyle),
    detail: command ? basename(command) : macAppPath ? 'Installed app' : undefined,
    command,
    macAppName: candidate.macAppName,
    appPath: macAppPath ?? (process.platform === 'win32' ? command : undefined),
    lineStyle: candidate.lineStyle,
    openDirectory: candidate.openDirectory
  }
}

async function getAvailableEditors(): Promise<ResolvedEditor[]> {
  const editors = await Promise.all(EDITOR_CANDIDATES.map(resolveEditor))
  return editors.filter((editor): editor is ResolvedEditor => editor !== null)
}

function defaultEditorId(editors: ResolvedEditor[]): string {
  return (
    editors.find((editor) => editor.kind === 'editor' && editor.supportsLine)?.id ??
    editors.find((editor) => editor.kind === 'editor')?.id ??
    DEFAULT_EDITOR_ID
  )
}

function isValidIconDataUrl(dataUrl: string | undefined): dataUrl is string {
  if (!dataUrl) return false
  const marker = ';base64,'
  const index = dataUrl.indexOf(marker)
  if (index === -1) return false
  return dataUrl.length - index - marker.length > 48
}

function nativeImageToDataUrl(image: Electron.NativeImage): string | undefined {
  if (image.isEmpty()) return undefined
  const resized = image.resize({ width: EDITOR_ICON_PX, height: EDITOR_ICON_PX, quality: 'best' })
  const source = resized.isEmpty() ? image : resized
  const buffer = source.toPNG()
  if (!buffer?.length) return undefined
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
  return isValidIconDataUrl(dataUrl) ? dataUrl : undefined
}

async function macIcnsPathToDataUrl(iconPath: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  const tmpPng = join(tmpdir(), `ds-gui-icon-${randomUUID()}.png`)
  try {
    await execFileAsync(
      '/usr/bin/sips',
      ['-s', 'format', 'png', '-z', String(EDITOR_ICON_PX), String(EDITOR_ICON_PX), iconPath, '--out', tmpPng],
      { timeout: 5_000, windowsHide: true }
    )
    const buffer = await readFile(tmpPng)
    if (!buffer.length) return undefined
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
    return isValidIconDataUrl(dataUrl) ? dataUrl : undefined
  } catch {
    return undefined
  } finally {
    await unlink(tmpPng).catch(() => {})
  }
}

async function getFileIconDataUrl(targetPath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(targetPath, { size: 'small' })
    return nativeImageToDataUrl(icon)
  } catch {
    return undefined
  }
}

async function macAppBundleIconDataUrl(appPath: string): Promise<string | undefined> {
  const infoPlistPath = join(appPath, 'Contents', 'Info')

  try {
    const { stdout } = await execFileAsync('/usr/bin/defaults', ['read', infoPlistPath, 'CFBundleIconFile'], {
      timeout: 2_000,
      windowsHide: true
    })
    const rawIconName = stdout.trim()
    if (rawIconName) {
      const fileName = rawIconName.endsWith('.icns') ? rawIconName : `${rawIconName}.icns`
      const iconPath = join(appPath, 'Contents', 'Resources', fileName)
      if (await pathExists(iconPath)) {
        const fromSips = await macIcnsPathToDataUrl(iconPath)
        if (fromSips) return fromSips
      }
    }
  } catch {
    /* try getFileIcon fallback below */
  }

  return getFileIconDataUrl(appPath)
}

async function editorIconDataUrl(editor: ResolvedEditor): Promise<string | undefined> {
  if (process.platform === 'darwin' && editor.appPath?.endsWith('.app')) {
    const bundleIcon = await macAppBundleIconDataUrl(editor.appPath)
    if (bundleIcon) return bundleIcon
  }

  const targetPath =
    editor.appPath ??
    (editor.command && (isAbsolute(editor.command) || process.platform === 'win32')
      ? editor.command
      : undefined)

  if (!targetPath) return undefined
  return getFileIconDataUrl(targetPath)
}

export async function listEditorsResult(): Promise<EditorListResult> {
  const editors = await getAvailableEditors()
  const icons = await Promise.all(editors.map((editor) => editorIconDataUrl(editor)))
  return {
    editors: editors.map(
      (
        {
          command: _command,
          macAppName: _macAppName,
          appPath: _appPath,
          lineStyle: _lineStyle,
          openDirectory: _openDirectory,
          ...editor
        },
        index
      ) => ({
        ...editor,
        ...(isValidIconDataUrl(icons[index]) ? { iconDataUrl: icons[index] } : {})
      })
    ),
    defaultEditorId: defaultEditorId(editors)
  }
}

function formatPathForEditor(targetPath: string, line?: number, column?: number): string {
  const safeLine = typeof line === 'number' && line > 0 ? Math.floor(line) : undefined
  const safeColumn = typeof column === 'number' && column > 0 ? Math.floor(column) : undefined
  if (!safeLine) return targetPath
  return `${targetPath}:${safeLine}${safeColumn ? `:${safeColumn}` : ''}`
}

function buildEditorArgs(editor: ResolvedEditor, targetPath: string, line?: number, column?: number): string[] {
  if (editor.openDirectory) return [targetPath]
  if (!editor.lineStyle || !line) return [targetPath]

  if (editor.lineStyle === 'xcode') return ['-l', String(Math.floor(line)), targetPath]
  if (editor.lineStyle === 'vscode') return ['-g', formatPathForEditor(targetPath, line, column)]
  if (editor.lineStyle === 'sublime' || editor.lineStyle === 'zed') {
    return [formatPathForEditor(targetPath, line, column)]
  }
  return [targetPath]
}

async function directoryForOpenTarget(targetPath: string): Promise<string> {
  try {
    const info = await stat(targetPath)
    return info.isDirectory() ? targetPath : dirname(targetPath)
  } catch {
    return dirname(targetPath)
  }
}

async function openWithResolvedEditor(
  editor: ResolvedEditor,
  targetPath: string,
  line?: number,
  column?: number
): Promise<void> {
  if (editor.id === 'finder') {
    shell.showItemInFolder(targetPath)
    return
  }

  if (editor.id === 'system') {
    const result = await openPathWithShell(targetPath)
    if (!result.ok) throw new Error(result.message ?? 'Could not open path.')
    return
  }

  const openTarget = editor.openDirectory ? await directoryForOpenTarget(targetPath) : targetPath

  if (editor.command) {
    try {
      await execFileAsync(editor.command, buildEditorArgs(editor, openTarget, line, column), {
        timeout: 10_000,
        windowsHide: true
      })
      return
    } catch (error) {
      if (process.platform !== 'darwin' || !editor.macAppName) throw error
    }
  }

  if (process.platform === 'darwin' && editor.macAppName) {
    await execFileAsync('open', ['-a', editor.macAppName, openTarget], {
      timeout: 10_000,
      windowsHide: true
    })
    return
  }

  const result = await openPathWithShell(openTarget)
  if (!result.ok) throw new Error(result.message ?? 'Could not open path.')
}

export async function openEditorPath(payload: OpenEditorPathOptions): Promise<EditorOpenResult> {
  try {
    const editors = await getAvailableEditors()
    const fallbackId = defaultEditorId(editors)
    const requestedId = payload.editorId?.trim()
    const editor =
      editors.find((item) => item.id === requestedId) ??
      editors.find((item) => item.id === fallbackId) ??
      editors.find((item) => item.id === DEFAULT_EDITOR_ID)
    if (!editor) throw new Error('No editor or system opener is available.')

    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    await openWithResolvedEditor(editor, targetPath, payload.line, payload.column)
    return { ok: true, path: targetPath, editorId: editor.id }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
