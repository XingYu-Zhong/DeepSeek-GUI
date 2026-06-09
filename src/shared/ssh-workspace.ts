export type ParsedSshWorkspaceUri = {
  connectionId: string
  remotePath: string
}

const SSH_WORKSPACE_PREFIX = 'ssh://'

function normalizeRemotePath(value: string): string {
  const raw = value.trim().replace(/\0/g, '').replaceAll('\\', '/')
  if (!raw) return ''
  const homeRelative = raw === '~' || raw.startsWith('~/')
  const absolute = raw.startsWith('/')
  const source = homeRelative
    ? raw === '~' ? '' : raw.slice(2)
    : absolute ? raw.slice(1) : raw
  const parts: string[] = []
  for (const part of source.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      const last = parts[parts.length - 1]
      if (last && last !== '..') {
        parts.pop()
      } else if (!absolute && !homeRelative) {
        parts.push(part)
      }
      continue
    }
    parts.push(part)
  }
  const joined = parts.join('/')
  if (homeRelative) return joined ? `~/${joined}` : '~'
  if (absolute) return `/${joined}`
  return joined
}

function cleanRemotePath(value: string): string {
  return normalizeRemotePath(value) || '~'
}

function encodePath(value: string): string {
  return encodeURIComponent(cleanRemotePath(value))
}

function decodePath(value: string): string {
  try {
    return cleanRemotePath(decodeURIComponent(value))
  } catch {
    return cleanRemotePath(value)
  }
}

function encodeConnectionId(value: string): string {
  const id = value.trim()
  if (!id) throw new Error('SSH connection id is required.')
  return encodeURIComponent(id)
}

function decodeConnectionId(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function isSshWorkspacePath(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith(SSH_WORKSPACE_PREFIX)
}

export function buildSshWorkspaceUri(connectionId: string, remotePath: string): string {
  return `${SSH_WORKSPACE_PREFIX}${encodeConnectionId(connectionId)}/${encodePath(remotePath)}`
}

export function parseSshWorkspaceUri(value: string): ParsedSshWorkspaceUri {
  const trimmed = value.trim()
  if (!isSshWorkspacePath(trimmed)) {
    throw new Error('SSH workspace URI is required.')
  }

  const rest = trimmed.slice(SSH_WORKSPACE_PREFIX.length)
  const slash = rest.indexOf('/')
  const rawConnectionId = slash >= 0 ? rest.slice(0, slash) : rest
  const rawPath = slash >= 0 ? rest.slice(slash + 1) : ''
  const connectionId = decodeConnectionId(rawConnectionId).trim()
  if (!connectionId) throw new Error('SSH workspace URI is missing a connection id.')
  return {
    connectionId,
    remotePath: decodePath(rawPath)
  }
}

export function sshRemoteBasename(remotePath: string): string {
  const cleaned = cleanRemotePath(remotePath).replace(/\/+$/, '')
  if (cleaned === '~' || cleaned === '/') return cleaned
  const parts = cleaned.split('/').filter(Boolean)
  return parts[parts.length - 1] || cleaned
}

export function joinSshRemotePath(base: string, next: string): string {
  const cleanedBase = cleanRemotePath(base).replace(/\/+$/, '')
  const cleanedNext = next.trim().replace(/\0/g, '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!cleanedNext) return cleanedBase
  if (!cleanedBase || cleanedBase === '/') return cleanRemotePath(`/${cleanedNext}`)
  return cleanRemotePath(`${cleanedBase}/${cleanedNext}`)
}

export function sshRemoteDirname(remotePath: string): string {
  const cleaned = cleanRemotePath(remotePath).replace(/\/+$/, '')
  if (cleaned === '~' || cleaned === '/') return cleaned
  const slash = cleaned.lastIndexOf('/')
  if (slash < 0) return '~'
  if (slash === 0) return '/'
  return cleaned.slice(0, slash)
}

export function appendSshWorkspacePath(uri: string, next: string): string {
  const parsed = parseSshWorkspaceUri(uri)
  return buildSshWorkspaceUri(parsed.connectionId, joinSshRemotePath(parsed.remotePath, next))
}

export function dirnameSshWorkspaceUri(uri: string): string {
  const parsed = parseSshWorkspaceUri(uri)
  return buildSshWorkspaceUri(parsed.connectionId, sshRemoteDirname(parsed.remotePath))
}

export function sshWorkspaceLabel(value: string): string {
  const parsed = parseSshWorkspaceUri(value)
  const base = sshRemoteBasename(parsed.remotePath)
  return `${parsed.connectionId}:${base}`
}
