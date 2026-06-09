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

export async function listWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  try {
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

export async function renameWorkspaceEntry(
  payload: WorkspaceEntryRenamePayload
): Promise<WorkspaceEntryRenameResult> {
  try {
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
