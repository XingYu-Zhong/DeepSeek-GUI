/**
 * Kun-side mirror of the shared GUI plan contract from
 * Kun's `src/shared/gui-plan.ts`.
 *
 * The renderer and the Kun package live in the same repo but
 * TypeScript's `rootDir` constraint prevents Kun from
 * referencing the renderer-side file at build time. The values and
 * types are therefore re-declared here; the renderer remains the
 * canonical owner of the source of truth. Keep the two files in
 * sync when changing the public surface.
 */

export const GUI_PLAN_RELATIVE_DIR = '.kunsdd/plan'
export const GUI_PLAN_LEGACY_RELATIVE_DIR = '.deepseekgui/plan'
export const GUI_PLAN_ACCEPTED_RELATIVE_DIRS = [
  GUI_PLAN_RELATIVE_DIR,
  GUI_PLAN_LEGACY_RELATIVE_DIR
] as const

export const GUI_PLAN_CREATE_PLAN_TOOL_NAME = 'create_plan'

export function isGuiPlanRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').toLowerCase()
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
  const normalized = value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').toLowerCase()
  if (!normalized.endsWith('.md')) return false
  if (!normalized.startsWith(`${GUI_PLAN_RELATIVE_DIR}/`)) return false
  const rest = normalized.slice(GUI_PLAN_RELATIVE_DIR.length + 1)
  if (!rest || rest.includes('/')) return false
  return !rest.split('/').some((part) => part === '..')
}

export function buildGuiPlanId(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')}:${relativePath.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').toLowerCase()}`
}

export function guiPlanWorkspaceMatches(actual: string, expected: string): boolean {
  return (
    actual.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() ===
    expected.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  )
}

export type GuiPlanOperation = 'draft' | 'refine'

export type CreatePlanToolInput = {
  markdown: string
  source_request?: string
  title?: string
  operation: GuiPlanOperation
  plan_id?: string
  plan_relative_path?: string
}

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

export function buildPlanRelativePath(featureName: string, suffix?: number): string {
  const safeSuffix = typeof suffix === 'number' && suffix > 1 ? `-${Math.floor(suffix)}` : ''
  return `${GUI_PLAN_RELATIVE_DIR}/${featureName}${safeSuffix}.md`
}

export function nextAvailablePlanRelativePath(
  featureName: string,
  existingRelativePaths: Iterable<string>,
  maxAttempts = 50
): string {
  const existing = new Set([...existingRelativePaths])
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = buildPlanRelativePath(featureName, attempt)
    if (!existing.has(candidate)) return candidate
  }
  return buildPlanRelativePath(`${featureName}-${Date.now()}`)
}

export function planDisplayNameFromRelativePath(relativePath: string): string {
  const fileName = relativePath.split('/').pop() ?? ''
  return fileName.replace(/\.md$/i, '') || 'plan'
}

export function planFeatureNameFromRequest(request: string): string {
  return request.trim().slice(0, 96) || 'plan'
}
