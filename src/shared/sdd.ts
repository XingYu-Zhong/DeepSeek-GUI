export const SDD_RELATIVE_DIR = '.kunsdd'
export const SDD_DRAFT_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/draft`
export const SDD_IMAGE_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/img`
export const SDD_DRAFT_FILE_NAME = 'requirement.md'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSddRelativePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function buildSddDraftRelativePath(id: string): string {
  return `${SDD_DRAFT_RELATIVE_DIR}/${id}/${SDD_DRAFT_FILE_NAME}`
}

export function isSddDraftRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  return (
    parts.length === 4 &&
    parts[0] === '.kunsdd' &&
    parts[1] === 'draft' &&
    UUID_LIKE.test(parts[2] ?? '') &&
    parts[3] === SDD_DRAFT_FILE_NAME
  )
}

export function isSddImageRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  if (!normalized.startsWith(`${SDD_IMAGE_RELATIVE_DIR}/`)) return false
  const rest = normalized.slice(SDD_IMAGE_RELATIVE_DIR.length + 1)
  return Boolean(rest) && !rest.split('/').some((part) => !part || part === '.' || part === '..')
}
