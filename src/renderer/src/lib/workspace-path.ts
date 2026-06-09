function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isInternalTemporaryWorkspace(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return (
    /\/deepseek-tui-updates\/tmp(?:\/|$)/.test(normalized)
    || normalized === '/tmp'
    || normalized.startsWith('/tmp/')
    || normalized === '/private/tmp'
    || normalized.startsWith('/private/tmp/')
    || /^\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/.test(normalized)
    || /^\/private\/var\/folders\/[^/]+\/[^/]+\/t(?:\/|$)/.test(normalized)
    || /\/appdata\/local\/temp(?:\/|$)/.test(normalized)
  )
}

export function isClawWorkspacePath(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return normalized.includes('/.deepseekgui/claw/')
}

export function isInternalDeepSeekGuiWorkspace(path?: string): boolean {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return false
  const normalized = normalizePathForMatch(trimmed)
  return (
    normalized === '~/.deepseekgui/write_workspace'
    || normalized.endsWith('/.deepseekgui/write_workspace')
  )
}

export function normalizeWorkspaceRoot(path?: string): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  if (isInternalTemporaryWorkspace(trimmed)) return ''
  return trimmed
}
