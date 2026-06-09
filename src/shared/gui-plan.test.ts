import { describe, expect, it } from 'vitest'
import {
  buildGuiPlanId,
  buildPlanRelativePath,
  GUI_PLAN_RELATIVE_DIR,
  guiPlanWorkspaceMatches,
  isGuiPlanCurrentRelativePath,
  isGuiPlanRelativePath,
  nextAvailablePlanRelativePath,
  planDisplayNameFromRelativePath,
  planFeatureNameFromRequest,
  validateCreatePlanToolInput
} from './gui-plan'

describe('gui-plan path validation', () => {
  it('accepts direct Markdown files under the plan directory', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.md`)).toBe(true)
    expect(isGuiPlanRelativePath(`  ${GUI_PLAN_RELATIVE_DIR}/Login.md  `)).toBe(true)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}\\login.md`)).toBe(true)
    expect(isGuiPlanRelativePath('.deepseekgui/plan/login.md')).toBe(true)
    expect(isGuiPlanCurrentRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.md`)).toBe(true)
    expect(isGuiPlanCurrentRelativePath('.deepseekgui/plan/login.md')).toBe(false)
  })

  it('rejects nested paths', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/nested/login.md`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/a/b/c.md`)).toBe(false)
  })

  it('rejects traversal paths', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/../escape.md`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/..`)).toBe(false)
    expect(isGuiPlanRelativePath('../plan.md')).toBe(false)
    expect(isGuiPlanRelativePath(`plans/foo.md`)).toBe(false)
  })

  it('rejects non-Markdown extensions and empty names', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.txt`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/.json`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/`)).toBe(false)
  })

  it('handles duplicate feature names by suffixing attempts', () => {
    const existing = [buildPlanRelativePath('login', 1), buildPlanRelativePath('login', 2)]
    const next = nextAvailablePlanRelativePath('login', existing)
    expect(next).toBe(buildPlanRelativePath('login', 3))
  })

  it('produces a stable plan id from workspace and path', () => {
    expect(buildGuiPlanId('/tmp/ws', '.kunsdd/plan/login.md')).toBe(
      '/tmp/ws:.kunsdd/plan/login.md'
    )
    expect(buildGuiPlanId('/tmp/ws', '.kunsdd/plan/Login.md')).toBe(
      buildGuiPlanId('/tmp/ws', '.kunsdd/plan/login.md')
    )
    expect(buildGuiPlanId('/tmp/ws', '.deepseekgui/plan/Login.md')).toBe(
      buildGuiPlanId('/tmp/ws', '.deepseekgui/plan/login.md')
    )
  })

  it('compares workspace roots case-insensitively with trailing slash tolerance', () => {
    expect(guiPlanWorkspaceMatches('/tmp/ws', '/tmp/ws')).toBe(true)
    expect(guiPlanWorkspaceMatches('/tmp/ws/', '/tmp/ws')).toBe(true)
    expect(guiPlanWorkspaceMatches('C:\\tmp\\ws', 'c:/tmp/ws')).toBe(true)
    expect(guiPlanWorkspaceMatches('/tmp/ws', '/tmp/other')).toBe(false)
  })
})

describe('plan feature name sanitisation', () => {
  it('handles unicode and emoji request strings', () => {
    const name = planFeatureNameFromRequest('登录：添加 OAuth 🪪')
    expect(name).toBeTruthy()
    expect(name).not.toMatch(/[<>:"\\|?*]/)
  })

  it('falls back to "plan" for empty or whitespace input', () => {
    expect(planFeatureNameFromRequest('')).toBe('plan')
    expect(planFeatureNameFromRequest('   ')).toBe('plan')
    // The sanitizer keeps printable punctuation in the name, so
    // '!!!' is preserved (it is a legal filename on disk). The
    // important contract is that empty/whitespace inputs degrade
    // to the default 'plan' identifier.
    expect(planFeatureNameFromRequest('!!!')).toBe('!!!')
  })

  it('keeps the display name in sync with the relative path', () => {
    const path = buildPlanRelativePath('demo-feature', 2)
    expect(planDisplayNameFromRelativePath(path)).toBe('demo-feature-2')
  })
})

describe('create_plan tool input validation', () => {
  it('flags missing markdown and operation', () => {
    expect(validateCreatePlanToolInput({ operation: 'draft' })).toContain(
      'markdown is required and must be non-empty'
    )
    expect(validateCreatePlanToolInput({ markdown: '# hi' })).toContain(
      'operation must be either "draft" or "refine"'
    )
  })

  it('rejects non-Markdown plan relative paths', () => {
    const issues = validateCreatePlanToolInput({
      markdown: '## plan',
      operation: 'draft',
      plan_relative_path: 'plans/foo.txt'
    })
    expect(issues.join('|')).toMatch(/plan_relative_path must be a direct Markdown file/)
  })

  it('accepts a fully populated draft input', () => {
    expect(
      validateCreatePlanToolInput({
        markdown: '## plan',
        operation: 'draft',
        plan_relative_path: `${GUI_PLAN_RELATIVE_DIR}/login.md`,
        plan_id: 'pid_1',
        source_request: 'build login',
        title: 'Login flow'
      })
    ).toEqual([])
  })
})
