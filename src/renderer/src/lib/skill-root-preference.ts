import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

export type SkillRootId =
  | 'workspace-agents'
  | 'workspace-skills'
  | 'global-agents'
  | 'global-deepseek'

const DEFAULT_SKILL_ROOT_ID: SkillRootId = 'workspace-agents'
const SKILL_ROOT_PREFERENCE_KEY = 'deepseekgui.skillRootPreference'

function isSkillRootId(value: string): value is SkillRootId {
  return (
    value === 'workspace-agents' ||
    value === 'workspace-skills' ||
    value === 'global-agents' ||
    value === 'global-deepseek'
  )
}

export function loadPreferredSkillRootId(): SkillRootId {
  const raw = readBrowserStorageItem(SKILL_ROOT_PREFERENCE_KEY)?.trim() ?? ''
  return isSkillRootId(raw) ? raw : DEFAULT_SKILL_ROOT_ID
}

export function savePreferredSkillRootId(id: SkillRootId): void {
  writeBrowserStorageItem(SKILL_ROOT_PREFERENCE_KEY, id)
}

export function joinFsPath(base: string, suffix: string): string {
  const root = base.trim().replace(/[\\/]+$/, '')
  const tail = suffix.replace(/^[\\/]+/, '')
  if (!root) return tail
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root}${separator}${tail.replace(/[\\/]+/g, separator)}`
}
