import { clipboard } from 'electron'
import {
  mkdir,
  open as openFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  ClipboardImageReadResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileReadResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult,
  WorkspaceImageReadResult
} from '../../shared/workspace-file'
import {
  canonicalPath,
  compareWorkspaceEntries,
  expandHomePath,
  extensionFromName,
  normalizePathSeparators,
  normalizeUserPath,
  pathExists,
  resolveOpenTargetPath,
  resolveTargetPathWithinWorkspace,
  resolveWorkspaceDirectory,
  validateEntryName
} from './workspace-paths'
import {
  buildSshWorkspaceUri,
  isSshWorkspacePath,
  joinSshRemotePath,
  parseSshWorkspaceUri
} from '../../shared/ssh-workspace'
import type { AppSettingsV1, SshConnectionV1 } from '../../shared/app-settings'
import { runSshFileOperation } from './ssh-service'

const MAX_FILE_PREVIEW_BYTES = 1_500_000
const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024
const WORKSPACE_IMAGE_DIR = 'img'

const WORKSPACE_IMAGE_MIME_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon']
])

let workspaceSettingsProvider: (() => Promise<AppSettingsV1>) | null = null

export function configureWorkspaceFileSettingsProvider(
  provider: (() => Promise<AppSettingsV1>) | null
): void {
  workspaceSettingsProvider = provider
}

function shouldUseSshWorkspace(payload: { path?: string; workspaceRoot?: string }): boolean {
  return isSshWorkspacePath(payload.workspaceRoot) || isSshWorkspacePath(payload.path)
}

async function sshConnectionForWorkspaceUri(uri: string): Promise<{
  connection: SshConnectionV1
  root: string
  path: string
  connectionId: string
}> {
  if (!workspaceSettingsProvider) {
    throw new Error('SSH workspace settings are not available.')
  }
  const parsed = parseSshWorkspaceUri(uri)
  const settings = await workspaceSettingsProvider()
  const connection = settings.connections.ssh.find((item) => item.id === parsed.connectionId)
  if (!connection || !connection.enabled) {
    throw new Error('SSH connection is missing or disabled.')
  }
  const root = connection.remotePath.trim() || '~'
  return {
    connection,
    root,
    path: parsed.remotePath,
    connectionId: parsed.connectionId
  }
}

function resolveSshTargetUri(path: string | undefined, workspaceRoot?: string): string {
  const rawPath = path?.trim() ?? ''
  const rawRoot = workspaceRoot?.trim() ?? ''
  if (isSshWorkspacePath(rawPath)) return rawPath
  if (isSshWorkspacePath(rawRoot)) return rawRoot
  throw new Error('SSH workspace URI is required.')
}

function sshEntryExt(name: string, type: 'file' | 'directory'): string {
  return type === 'directory' ? '' : extensionFromName(name)
}

function sshRemotePathToUri(connectionId: string, path: string): string {
  return buildSshWorkspaceUri(connectionId, path)
}

function normalizeSshRemotePathForRelative(value: string): string {
  return value.trim().replace(/\0/g, '').replaceAll('\\', '/').replace(/\/+$/, '')
}

function sshRemoteDirnameForRelative(value: string): string {
  const normalized = normalizeSshRemotePathForRelative(value)
  if (!normalized || normalized === '/' || normalized === '~') return normalized || '~'
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return '~'
  if (slash === 0) return '/'
  return normalized.slice(0, slash)
}

function relativeSshRemotePath(fromDirectory: string, targetPath: string): string {
  const from = normalizeSshRemotePathForRelative(fromDirectory)
  const target = normalizeSshRemotePathForRelative(targetPath)
  const fromParts = from.split('/').filter(Boolean)
  const targetParts = target.split('/').filter(Boolean)
  let index = 0
  while (index < fromParts.length && index < targetParts.length && fromParts[index] === targetParts[index]) {
    index += 1
  }
  const up = fromParts.slice(index).map(() => '..')
  const down = targetParts.slice(index)
  return [...up, ...down].join('/') || targetParts.at(-1) || target
}

async function listSshWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'list',
    root: target.root,
    path: target.path
  })
  if (!result.ok) return result
  const root = sshRemotePathToUri(target.connectionId, result.root ?? result.path)
  const entries = (result.entries ?? [])
    .map((entry) => ({
      name: entry.name,
      path: sshRemotePathToUri(target.connectionId, entry.path),
      type: entry.type,
      ext: sshEntryExt(entry.name, entry.type)
    }))
    .sort(compareWorkspaceEntries)
  return { ok: true, root, entries }
}

async function readSshWorkspaceFile(payload: WorkspaceFileTarget): Promise<WorkspaceFileReadResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'readText',
    root: target.root,
    path: target.path,
    maxBytes: MAX_FILE_PREVIEW_BYTES
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    content: result.content ?? '',
    size: result.size ?? 0,
    truncated: result.truncated === true,
    ...(payload.line ? { line: payload.line } : {}),
    ...(payload.column ? { column: payload.column } : {})
  }
}

async function readSshWorkspaceImage(payload: WorkspaceFileTarget): Promise<WorkspaceImageReadResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const ext = extensionFromName(target.path).toLowerCase()
  const mimeType = WORKSPACE_IMAGE_MIME_BY_EXT.get(ext)
  if (!mimeType) {
    return { ok: false, message: 'This image type is not supported in Write mode.' }
  }
  const result = await runSshFileOperation(target.connection, {
    op: 'readBinary',
    root: target.root,
    path: target.path,
    maxBytes: MAX_IMAGE_PREVIEW_BYTES
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    dataUrl: `data:${mimeType};base64,${result.dataBase64 ?? ''}`,
    mimeType,
    size: result.size ?? 0
  }
}

async function writeSshWorkspaceFile(
  payload: WorkspaceFileWritePayload
): Promise<WorkspaceFileWriteResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'writeText',
    root: target.root,
    path: target.path,
    content: payload.content
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    savedAt: new Date().toISOString()
  }
}

async function createSshWorkspaceFile(
  payload: WorkspaceFileCreatePayload
): Promise<WorkspaceFileCreateResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'createFile',
    root: target.root,
    path: target.path,
    content: payload.content
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    createdAt: new Date().toISOString()
  }
}

async function createSshWorkspaceDirectory(
  payload: WorkspaceDirectoryCreatePayload
): Promise<WorkspaceDirectoryCreateResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'createDirectory',
    root: target.root,
    path: target.path
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    createdAt: new Date().toISOString()
  }
}

async function renameSshWorkspaceEntry(
  payload: WorkspaceEntryRenamePayload
): Promise<WorkspaceEntryRenameResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'rename',
    root: target.root,
    path: target.path,
    newName: payload.newName
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    previousPath: sshRemotePathToUri(target.connectionId, (result as { previousPath?: string }).previousPath ?? target.path),
    renamedAt: new Date().toISOString()
  }
}

async function deleteSshWorkspaceEntry(
  payload: WorkspaceEntryDeletePayload
): Promise<WorkspaceEntryDeleteResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'delete',
    root: target.root,
    path: target.path
  })
  if (!result.ok) return result
  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    deletedAt: new Date().toISOString()
  }
}

async function resolveSshWorkspaceFile(
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileResolveResult> {
  const targetUri = resolveSshTargetUri(payload.path, payload.workspaceRoot)
  const target = await sshConnectionForWorkspaceUri(targetUri)
  const result = await runSshFileOperation(target.connection, {
    op: 'stat',
    root: target.root,
    path: target.path
  })
  if (!result.ok) return result
  return { ok: true, path: sshRemotePathToUri(target.connectionId, result.path) }
}

export async function listWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await listSshWorkspaceDirectory(payload)
    }
    const root = await resolveWorkspaceDirectory(payload)
    const entries = await readdir(root, { withFileTypes: true })
    const normalized = entries
      .filter((entry) => entry.name !== '.DS_Store')
      .map((entry) => ({
        name: entry.name,
        path: join(root, entry.name),
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        ext: entry.isDirectory() ? '' : extensionFromName(entry.name)
      }))
      .sort(compareWorkspaceEntries)

    return { ok: true, root, entries: normalized }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceFile(payload: WorkspaceFileTarget): Promise<WorkspaceFileReadResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await readSshWorkspaceFile(payload)
    }
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }

    const maxBytes = Math.min(fileInfo.size, MAX_FILE_PREVIEW_BYTES)
    const handle = await openFile(targetPath, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.includes(0)) {
        return { ok: false, message: 'This file appears to be binary and cannot be previewed.' }
      }

      return {
        ok: true,
        path: targetPath,
        content: bytes.toString('utf8'),
        size: fileInfo.size,
        truncated: fileInfo.size > MAX_FILE_PREVIEW_BYTES,
        ...(payload.line ? { line: payload.line } : {}),
        ...(payload.column ? { column: payload.column } : {})
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceImage(
  payload: WorkspaceFileTarget
): Promise<WorkspaceImageReadResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await readSshWorkspaceImage(payload)
    }
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }
    if (fileInfo.size > MAX_IMAGE_PREVIEW_BYTES) {
      return { ok: false, message: 'This image is too large to preview.' }
    }

    const ext = extensionFromName(targetPath).toLowerCase()
    const mimeType = WORKSPACE_IMAGE_MIME_BY_EXT.get(ext)
    if (!mimeType) {
      return { ok: false, message: 'This image type is not supported in Write mode.' }
    }

    const bytes = await readFile(targetPath)
    return {
      ok: true,
      path: targetPath,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      mimeType,
      size: fileInfo.size
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function writeWorkspaceFile(
  payload: WorkspaceFileWritePayload
): Promise<WorkspaceFileWriteResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await writeSshWorkspaceFile(payload)
    }
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, payload.content, 'utf8')
    return {
      ok: true,
      path: targetPath,
      savedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createWorkspaceFile(
  payload: WorkspaceFileCreatePayload
): Promise<WorkspaceFileCreateResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await createSshWorkspaceFile(payload)
    }
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    await mkdir(dirname(targetPath), { recursive: true })
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'File already exists.' }
    }
    await writeFile(targetPath, payload.content ?? '', { encoding: 'utf8', flag: 'wx' })
    return {
      ok: true,
      path: targetPath,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createWorkspaceDirectory(
  payload: WorkspaceDirectoryCreatePayload
): Promise<WorkspaceDirectoryCreateResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await createSshWorkspaceDirectory(payload)
    }
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'Directory already exists.' }
    }
    await mkdir(targetPath)
    return {
      ok: true,
      path: targetPath,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function buildWorkspaceImageName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `pasted-image-${iso}-${randomUUID().slice(0, 8)}.png`
}

export async function readClipboardImage(): Promise<ClipboardImageReadResult> {
  try {
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return { ok: false, message: 'Clipboard does not currently contain an image.' }
    }

    const buffer = image.toPNG()
    if (!buffer.length) {
      return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
    }

    const size = image.getSize()
    return {
      ok: true,
      name: buildWorkspaceImageName(),
      mimeType: 'image/png',
      dataBase64: buffer.toString('base64'),
      byteSize: buffer.length,
      ...(size.width > 0 ? { width: size.width } : {}),
      ...(size.height > 0 ? { height: size.height } : {})
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function saveWorkspaceClipboardImage(
  payload: WorkspaceClipboardImageSavePayload
): Promise<WorkspaceClipboardImageSaveResult> {
  try {
    if (isSshWorkspacePath(payload.workspaceRoot)) {
      return await saveSshWorkspaceClipboardImage(payload)
    }
    const currentFilePath = await resolveOpenTargetPath(payload.currentFilePath, payload.workspaceRoot, {
      allowBasenameFallback: false
    })
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return { ok: false, message: 'Clipboard does not currently contain an image.' }
    }

    const buffer = image.toPNG()
    if (!buffer.length) {
      return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
    }

    const imageDirectory = payload.imageDirectory?.trim() || WORKSPACE_IMAGE_DIR
    const imageDir = await resolveTargetPathWithinWorkspace(imageDirectory, payload.workspaceRoot)
    await mkdir(imageDir, { recursive: true })

    const targetPath = await resolveTargetPathWithinWorkspace(
      join(imageDir, buildWorkspaceImageName()),
      payload.workspaceRoot
    )
    await writeFile(targetPath, buffer)

    return {
      ok: true,
      path: targetPath,
      markdownPath: normalizePathSeparators(relative(dirname(currentFilePath), targetPath)),
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function saveSshWorkspaceClipboardImage(
  payload: WorkspaceClipboardImageSavePayload
): Promise<WorkspaceClipboardImageSaveResult> {
  const target = await sshConnectionForWorkspaceUri(payload.currentFilePath || payload.workspaceRoot)
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return { ok: false, message: 'Clipboard does not currently contain an image.' }
  }

  const buffer = image.toPNG()
  if (!buffer.length) {
    return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
  }

  const imageDirectory = payload.imageDirectory?.trim() || WORKSPACE_IMAGE_DIR
  const imageDir = imageDirectory.startsWith('/') || imageDirectory.startsWith('~')
    ? imageDirectory
    : joinSshRemotePath(target.root, imageDirectory)
  const imageRemotePath = joinSshRemotePath(imageDir, buildWorkspaceImageName())
  const result = await runSshFileOperation(target.connection, {
    op: 'writeBinary',
    root: target.root,
    path: imageRemotePath,
    dataBase64: buffer.toString('base64')
  })
  if (!result.ok) return result

  return {
    ok: true,
    path: sshRemotePathToUri(target.connectionId, result.path),
    markdownPath: relativeSshRemotePath(
      sshRemoteDirnameForRelative(target.path),
      result.path
    ),
    createdAt: new Date().toISOString()
  }
}

export async function renameWorkspaceEntry(
  payload: WorkspaceEntryRenamePayload
): Promise<WorkspaceEntryRenameResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await renameSshWorkspaceEntry(payload)
    }
    const sourcePath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    await stat(sourcePath)
    const nextName = validateEntryName(payload.newName)
    const targetPath = await resolveTargetPathWithinWorkspace(
      join(dirname(sourcePath), nextName),
      payload.workspaceRoot
    )
    if (sourcePath === targetPath) {
      return {
        ok: true,
        path: targetPath,
        previousPath: sourcePath,
        renamedAt: new Date().toISOString()
      }
    }
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'A file or directory with that name already exists.' }
    }
    await rename(sourcePath, targetPath)
    return {
      ok: true,
      path: targetPath,
      previousPath: sourcePath,
      renamedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function deleteWorkspaceEntry(
  payload: WorkspaceEntryDeletePayload
): Promise<WorkspaceEntryDeleteResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await deleteSshWorkspaceEntry(payload)
    }
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    const info = await stat(targetPath)
    if (payload.workspaceRoot?.trim()) {
      const workspacePath = await canonicalPath(resolve(expandHomePath(payload.workspaceRoot)))
      if (targetPath === workspacePath) {
        return { ok: false, message: 'Deleting the workspace root is not supported.' }
      }
    }
    if (info.isDirectory()) {
      await rm(targetPath, { recursive: true })
    } else {
      await unlink(targetPath)
    }
    return {
      ok: true,
      path: targetPath,
      deletedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function resolveWorkspaceFile(
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileResolveResult> {
  try {
    if (shouldUseSshWorkspace(payload)) {
      return await resolveSshWorkspaceFile(payload)
    }
    const normalizedPath = normalizeUserPath(payload.path)
    const expandedPath = expandHomePath(normalizedPath)
    if (!isAbsolute(expandedPath) && !payload.workspaceRoot?.trim()) {
      return {
        ok: false,
        message: 'Workspace root is required to resolve a relative file path.'
      }
    }

    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot, {
      allowBasenameFallback: false
    })
    return { ok: true, path: targetPath }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
