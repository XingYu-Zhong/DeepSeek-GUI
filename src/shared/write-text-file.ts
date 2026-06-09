import type { WorkspaceEntry } from './workspace-file'

export const WRITE_TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text'
])

export const WRITE_IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.ico'
])

export function isWriteTextFileExtension(ext: string): boolean {
  return WRITE_TEXT_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWriteImageFileExtension(ext: string): boolean {
  return WRITE_IMAGE_FILE_EXTENSIONS.has(ext.trim().toLowerCase())
}

export function isWriteTextFilePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const dot = normalized.lastIndexOf('.')
  if (dot < 0) return false
  const slash = normalized.lastIndexOf('/')
  if (dot < slash) return false
  return isWriteTextFileExtension(normalized.slice(dot))
}

export function isWriteImageFilePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const dot = normalized.lastIndexOf('.')
  if (dot < 0) return false
  const slash = normalized.lastIndexOf('/')
  if (dot < slash) return false
  return isWriteImageFileExtension(normalized.slice(dot))
}

export function isWriteWorkspaceFilePath(path: string): boolean {
  return isWriteTextFilePath(path) || isWriteImageFilePath(path)
}

export function isWriteWorkspaceEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'directory' || isWriteTextFileExtension(entry.ext) || isWriteImageFileExtension(entry.ext)
}
