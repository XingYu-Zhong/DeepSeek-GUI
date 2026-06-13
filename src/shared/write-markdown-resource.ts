function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

const WINDOWS_DRIVE_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/
const WINDOWS_DRIVE_SEGMENT_RE = /^[a-zA-Z]:$/

function isWindowsDriveAbsolutePath(value: string): boolean {
  return WINDOWS_DRIVE_ABSOLUTE_RE.test(value.trim())
}

function isUncPath(value: string): boolean {
  return /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value.trim())
}

function dirnamePortable(filePath: string): string {
  const normalized = normalizePath(filePath)
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return ''
  if (slash === 0) return '/'
  return normalized.slice(0, slash)
}

function normalizeJoinedPath(pathname: string): string {
  const normalized = normalizePath(pathname)
  const prefix = normalized.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of normalized.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  return `${prefix}${parts.join('/')}`
}

function normalizeUncPath(pathname: string): string {
  return `//${normalizeJoinedPath(normalizePath(pathname).replace(/^\/+/, ''))}`
}

function normalizeAbsolutePath(pathname: string): string {
  return isUncPath(pathname) ? normalizeUncPath(pathname) : normalizeJoinedPath(pathname)
}

function encodePathSegment(part: string): string {
  if (WINDOWS_DRIVE_SEGMENT_RE.test(part)) return part
  return encodeURIComponent(part).replaceAll('~', '%7E')
}

export function writePathToFileUrl(pathname: string): string {
  if (isUncPath(pathname)) {
    const normalized = normalizeUncPath(pathname)
    const [host = '', ...parts] = normalized.replace(/^\/\//, '').split('/')
    const encodedPath = parts.map(encodePathSegment).join('/')
    return `file://${host}${encodedPath ? `/${encodedPath}` : ''}`
  }
  const normalized = normalizeJoinedPath(pathname)
  const encoded = normalized.split('/').map(encodePathSegment).join('/')
  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}

export function isExplicitWriteResourceUrl(value: string): boolean {
  const trimmed = value.trim()
  if (isWindowsDriveAbsolutePath(trimmed) || isUncPath(trimmed)) return false
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
}

function explicitResourceProtocol(value: string): string | null {
  try {
    return new URL(value).protocol
  } catch {
    return null
  }
}

export function resolveWriteMarkdownResource(
  src: string | undefined,
  filePath?: string | null
): string | undefined {
  const resolvedPath = resolveWriteMarkdownResourcePath(src, filePath)
  if (resolvedPath) return writePathToFileUrl(resolvedPath)
  if (!src?.trim()) return src
  const value = src.trim()
  return explicitResourceProtocol(value) === 'file:' ? undefined : src
}

export function resolveWriteMarkdownResourcePath(
  src: string | undefined,
  filePath?: string | null
): string | undefined {
  if (!src?.trim() || !filePath) return undefined
  const value = src.trim()
  if (isExplicitWriteResourceUrl(value) || value.startsWith('#')) return undefined
  const [pathname, suffix = ''] = value.split(/([?#].*)/, 2)
  const baseDir = dirnamePortable(filePath)
  if (!baseDir || suffix) return undefined
  const resolved = pathname.startsWith('/') || isWindowsDriveAbsolutePath(pathname) || isUncPath(pathname)
    ? normalizeAbsolutePath(pathname)
    : normalizeJoinedPath(`${baseDir}/${pathname}`)
  return resolved
}
