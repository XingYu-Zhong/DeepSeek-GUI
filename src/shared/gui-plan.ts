export const GUI_PLAN_RELATIVE_DIR = '.kunsdd/plan'
export const GUI_PLAN_LEGACY_RELATIVE_DIR = '.deepseekgui/plan'
export const GUI_PLAN_ACCEPTED_RELATIVE_DIRS = [
  GUI_PLAN_RELATIVE_DIR,
  GUI_PLAN_LEGACY_RELATIVE_DIR
] as const

const MAX_FEATURE_NAME_LENGTH = 96
const ILLEGAL_FILENAME_CHARS = /[<>:"|?*\\/]+/g
const SEPARATOR_CHARS = /[\s_]+/g
const MULTIPLE_DASHES = /-+/g

function trimPlanName(value: string): string {
  return value
    .replace(MULTIPLE_DASHES, '-')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '')
}

export function planFeatureNameFromRequest(request: string): string {
  const normalized = request
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .replace(ILLEGAL_FILENAME_CHARS, ' ')
    .replace(SEPARATOR_CHARS, '-')
  const compact = trimPlanName(normalized)
  const safe = compact || 'plan'
  return safe.slice(0, MAX_FEATURE_NAME_LENGTH).replace(/[.\-\s]+$/, '') || 'plan'
}

export function buildPlanRelativePath(featureName: string, suffix?: number): string {
  const safeFeatureName = planFeatureNameFromRequest(featureName)
  const safeSuffix = typeof suffix === 'number' && suffix > 1 ? `-${Math.floor(suffix)}` : ''
  return `${GUI_PLAN_RELATIVE_DIR}/${safeFeatureName}${safeSuffix}.md`
}

function normalizeRelativePathForCompare(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').toLowerCase()
}

export function isGuiPlanRelativePath(value: string): boolean {
  const normalized = normalizeRelativePathForCompare(value.trim())
  if (!normalized.endsWith('.md')) return false
  const matchedDir = GUI_PLAN_ACCEPTED_RELATIVE_DIRS.find((dir) =>
    normalized.startsWith(`${dir}/`)
  )
  if (!matchedDir) return false
  const rest = normalized.slice(matchedDir.length + 1)
  if (!rest || rest.includes('/')) return false
  return !rest.split('/').some((part) => part === '..')
}

export function isGuiPlanCurrentRelativePath(value: string): boolean {
  const normalized = normalizeRelativePathForCompare(value.trim())
  if (!normalized.endsWith('.md')) return false
  if (!normalized.startsWith(`${GUI_PLAN_RELATIVE_DIR}/`)) return false
  const rest = normalized.slice(GUI_PLAN_RELATIVE_DIR.length + 1)
  if (!rest || rest.includes('/')) return false
  return !rest.split('/').some((part) => part === '..')
}

export function nextAvailablePlanRelativePath(
  featureName: string,
  existingRelativePaths: Iterable<string>,
  maxAttempts = 50
): string {
  const existing = new Set([...existingRelativePaths].map(normalizeRelativePathForCompare))
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = buildPlanRelativePath(featureName, attempt)
    if (!existing.has(normalizeRelativePathForCompare(candidate))) return candidate
  }
  return buildPlanRelativePath(`${featureName}-${Date.now()}`)
}

export function planDisplayNameFromRelativePath(relativePath: string): string {
  const normalized = normalizeRelativePathForCompare(relativePath)
  const fileName = normalized.split('/').pop() ?? ''
  return fileName.replace(/\.md$/i, '') || 'plan'
}

/**
 * Stable name of the native Kun plan tool. Kept distinct from the
 * historical `gui_plan_create` MCP bridge so the renderer and Kun
 * can recognize the new contract without colliding with legacy code.
 */
export const GUI_PLAN_CREATE_PLAN_TOOL_NAME = 'create_plan'

/**
 * Reserved plan path placeholder used inside hidden plan prompts. The
 * renderer may still surface `<gui_plan>` Markdown in fallback flows,
 * but new turns instruct the model to call `create_plan` instead.
 */
export const GUI_PLAN_OPEN_TAG = '<gui_plan>'
export const GUI_PLAN_CLOSE_TAG = '</gui_plan>'

/**
 * Plan tool operation kinds. The renderer passes one of these on every
 * plan/refine turn so Kun can scope tool availability to the
 * active plan context.
 */
export type GuiPlanOperation = 'draft' | 'refine'

/**
 * Shared input contract for the native `create_plan` tool. The schema is
 * the public surface the model sees; validation is enforced by Kun
 * in addition to these TypeScript types so the GUI can preview calls.
 */
export type CreatePlanToolInput = {
  /** Complete Markdown plan content. */
  markdown: string
  /** Original user request the plan answers. */
  source_request?: string
  /** Short display title for the plan, e.g. "OAuth login flow". */
  title?: string
  /** Operation that triggered the tool call. */
  operation: GuiPlanOperation
  /**
   * Optional reserved plan id or relative path supplied by the GUI on
   * the surrounding turn. When present, the tool MUST write to that
   * exact path; when absent, the tool writes to a fresh plan file.
   */
  plan_id?: string
  plan_relative_path?: string
}

/**
 * Structured tool output returned to the model and surfaced as the
 * authoritative plan update for the renderer. Persisted on the tool
 * result item so reconnect/replay can rebuild the Plan panel.
 */
export type CreatePlanToolOutput = {
  summary: string
  plan_id: string
  workspace_root: string
  relative_path: string
  absolute_path?: string
  source_request?: string
  title?: string
  operation: GuiPlanOperation
  saved_at: string
  content_hash: string
  byte_size: number
}

/**
 * Build the deterministic plan id used by both renderer and Kun.
 * The id is derived from the workspace root and relative path so it
 * remains stable across reconnects, replays, and rename-free edits.
 */
export function buildGuiPlanId(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')}:${normalizeRelativePathForCompare(relativePath)}`
}

/**
 * Validate a plan input from the renderer. Returns a list of issues;
 * an empty list means the input is acceptable.
 */
export function validateCreatePlanToolInput(input: Partial<CreatePlanToolInput>): string[] {
  const issues: string[] = []
  if (typeof input.markdown !== 'string' || !input.markdown.trim()) {
    issues.push('markdown is required and must be non-empty')
  }
  if (input.operation !== 'draft' && input.operation !== 'refine') {
    issues.push('operation must be either "draft" or "refine"')
  }
  if (input.plan_relative_path != null) {
    const path = String(input.plan_relative_path).trim()
    if (!path) {
      issues.push('plan_relative_path must be non-empty when supplied')
    } else if (!isGuiPlanRelativePath(path)) {
      issues.push('plan_relative_path must be a direct Markdown file under .kunsdd/plan')
    }
  }
  if (input.plan_id != null && typeof input.plan_id !== 'string') {
    issues.push('plan_id must be a string when supplied')
  }
  return issues
}

/**
 * Compare two workspace roots using the same normalization as the
 * plan path checks. Used by Kun to verify the active workspace
 * matches the one encoded in a plan context.
 */
export function guiPlanWorkspaceMatches(actual: string, expected: string): boolean {
  return (
    actual.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() ===
    expected.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  )
}
