export const SDD_RELATIVE_DIR = '.kunsdd'
/**
 * One requirement = one self-contained directory:
 * `.kunsdd/requirements/<uuid>/{requirement.md, trace.json, img/, proto/, chat/}`.
 * Plans stay under `.kunsdd/plan/sdd-<uuid>.md`, linked by the uuid.
 */
export const SDD_REQUIREMENTS_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/requirements`
export const SDD_DRAFT_FILE_NAME = 'requirement.md'
export const SDD_TRACE_FILE_NAME = 'trace.json'
export const SDD_CHAT_DIR_NAME = 'chat'
export const SDD_CHAT_META_FILE_NAME = 'meta.json'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSddRelativePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function buildSddDraftRelativePath(id: string): string {
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${id}/${SDD_DRAFT_FILE_NAME}`
}

export function isSddDraftRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  return (
    parts.length === 4 &&
    parts[0] === '.kunsdd' &&
    parts[1] === 'requirements' &&
    UUID_LIKE.test(parts[2] ?? '') &&
    parts[3] === SDD_DRAFT_FILE_NAME
  )
}

/** Extract the requirement folder (uuid) from a draft-relative path, or null. */
export function sddDraftFolderFromRelativePath(value: string): string | null {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (parts.length !== 4 || parts[0] !== '.kunsdd' || parts[1] !== 'requirements') return null
  return UUID_LIKE.test(parts[2] ?? '') ? parts[2] : null
}

/** The requirement's self-contained unit directory (`.kunsdd/requirements/<uuid>`). */
export function sddRequirementUnitDir(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  return folder ? `${SDD_REQUIREMENTS_RELATIVE_DIR}/${folder}` : null
}

/** Images pasted into / generated for this requirement live in `<unit>/img`. */
export function sddUnitImageDir(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/img` : null
}

/** Interactive prototypes generated for this requirement live in `<unit>/proto`. */
export function sddUnitProtoDir(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/proto` : null
}

/** AI conversation records for this requirement live in `<unit>/chat`. */
export function sddUnitChatDir(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/${SDD_CHAT_DIR_NAME}` : null
}

/** Sidecar trace file for a draft (`<unit>/trace.json`). */
export function sddDraftTraceRelativePath(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/${SDD_TRACE_FILE_NAME}` : null
}

/**
 * Map an SDD-generated plan path (`.kunsdd/plan/sdd-<uuid>[-n].md`) back to
 * its requirement draft path, or null for non-SDD plans.
 */
export function sddDraftRelativePathForPlanPath(planRelativePath: string): string | null {
  const normalized = normalizeSddRelativePath(planRelativePath)
  const match = /^\.kunsdd\/plan\/sdd-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?\.md$/i.exec(
    normalized
  )
  if (!match) return null
  return buildSddDraftRelativePath(match[1].toLowerCase())
}

/** Whether a workspace-relative path is inside ANY requirement unit's subdir. */
function isSddUnitSubPath(value: string, subdir: 'img' | 'proto'): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (parts.length < 5) return false
  if (parts[0] !== '.kunsdd' || parts[1] !== 'requirements') return false
  if (!UUID_LIKE.test(parts[2] ?? '')) return false
  if (parts[3] !== subdir) return false
  return !parts.slice(4).some((part) => !part || part === '.' || part === '..')
}

export function isSddImageRelativePath(value: string): boolean {
  return isSddUnitSubPath(value, 'img')
}

/** Generated interactive prototypes live under `<unit>/proto/`. */
export function isSddPrototypeRelativePath(value: string): boolean {
  return isSddUnitSubPath(value, 'proto')
}
