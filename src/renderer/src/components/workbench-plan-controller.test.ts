import { describe, expect, it } from 'vitest'
import { createGuiPlanArtifact } from '../plan/plan-store'
import {
  buildDraftGuiPlanTurnOverrides,
  buildGuiPlanTurnOverrides,
  resolvePlanTurnWorkspaceRoot
} from './workbench-plan-controller'

describe('workbench plan controller helpers', () => {
  it('prefers an explicit target workspace over stale workbench state', () => {
    expect(resolvePlanTurnWorkspaceRoot('/Users/codex/sdd-workspace/', '/Users/codex/stale-workspace')).toBe(
      '/Users/codex/sdd-workspace'
    )
    expect(resolvePlanTurnWorkspaceRoot(undefined, '/Users/codex/current-workspace/')).toBe(
      '/Users/codex/current-workspace'
    )
  })

  it('builds refine context only for the current plan workspace and thread', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/Users/codex/app/',
      threadId: 'thread-current',
      relativePath: '.kunsdd/plan/checkout.md',
      sourceRequest: 'Improve checkout',
      now: 1
    })

    expect(buildGuiPlanTurnOverrides(plan, '/Users/codex/app', 'thread-current')).toMatchObject({
      guiPlan: {
        operation: 'refine',
        workspaceRoot: '/Users/codex/app',
        relativePath: '.kunsdd/plan/checkout.md',
        planId: '/Users/codex/app:.kunsdd/plan/checkout.md',
        sourceRequest: 'Improve checkout'
      }
    })
    expect(buildGuiPlanTurnOverrides(plan, '/Users/codex/app', 'thread-stale')).toBeUndefined()
    expect(buildGuiPlanTurnOverrides(plan, '/Users/codex/other', 'thread-current')).toBeUndefined()
  })

  it('builds draft context for first-class GUI plan turns', () => {
    const result = buildDraftGuiPlanTurnOverrides({
      request: 'Build Login: OAuth / SSO?',
      workspaceRoot: '/Users/codex/app/',
      activeThreadId: 'thread-current',
      existingRelativePaths: ['.kunsdd/plan/build-login-oauth-sso.md']
    })

    expect(result.guiPlan).toEqual({
      operation: 'draft',
      workspaceRoot: '/Users/codex/app',
      relativePath: '.kunsdd/plan/build-login-oauth-sso-2.md',
      planId: '/Users/codex/app:.kunsdd/plan/build-login-oauth-sso-2.md',
      sourceRequest: 'Build Login: OAuth / SSO?',
      title: 'build-login-oauth-sso-2'
    })
  })
})
