import i18n from '../i18n'
import { isSshWorkspacePath, sshWorkspaceLabel } from '@shared/ssh-workspace'

const DEFAULT_WORKSPACE_PATH_SUFFIX = '/.deepseekgui/default_workspace'
const DEFAULT_WORKSPACE_LABEL = 'default'

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isDefaultWorkspacePath(path: string): boolean {
  const normalized = normalizePathForMatch(path)
  return (
    normalized === '~/.deepseekgui/default_workspace'
    || normalized.endsWith(DEFAULT_WORKSPACE_PATH_SUFFIX)
  )
}

export function workspaceLabelFromPath(path: string): string {
  const p = path?.trim() ?? ''
  if (!p) return i18n.t('common:workingDirectory')
  if (isSshWorkspacePath(p)) return sshWorkspaceLabel(p)
  if (isDefaultWorkspacePath(p)) return DEFAULT_WORKSPACE_LABEL
  const normalized = p.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/)
  const base = parts[parts.length - 1]
  return base || i18n.t('common:workingDirectory')
}
