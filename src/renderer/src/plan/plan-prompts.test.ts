import { describe, expect, it } from 'vitest'
import {
  buildDraftPlanPrompt,
  buildPlanBuildPrompt,
  buildRefinePlanPrompt,
  extractGuiPlanMarkdown,
  formatGuiPlanPromptForDisplay,
  getGuiPlanPromptKind,
  isGuiPlanDraftOrRefinePrompt,
  isGuiPlanInternalPrompt
} from './plan-prompts'

describe('plan-prompts', () => {
  it('builds draft prompts that route through the native create_plan tool', () => {
    const prompt = buildDraftPlanPrompt({
      request: 'Add auth',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.deepseekgui/plan/add-auth.md'
    })
    expect(prompt).toContain('The GUI will save your answer')
    expect(prompt).toContain('create_plan')
    expect(prompt).toContain('Do not call any other tools')
    expect(prompt).toContain('<gui_plan>')
    expect(prompt).toContain('Add auth')
  })

  it('formats internal plan prompts for chat display', () => {
    const draft = buildDraftPlanPrompt({
      request: 'Add auth',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.deepseekgui/plan/add-auth.md'
    })
    const refine = buildRefinePlanPrompt({
      feedback: 'Make it smaller',
      currentPlan: '# Old',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.deepseekgui/plan/add-auth.md'
    })
    expect(formatGuiPlanPromptForDisplay(draft)).toMatch(/^Create plan: Add auth/)
    expect(formatGuiPlanPromptForDisplay(refine)).toMatch(/^Revise plan: Make it smaller/)
    expect(formatGuiPlanPromptForDisplay(buildPlanBuildPrompt('.deepseekgui/plan/add-auth.md'))).toBe(
      'Build plan: .deepseekgui/plan/add-auth.md'
    )
    expect(isGuiPlanInternalPrompt(draft)).toBe(true)
    expect(getGuiPlanPromptKind(draft)).toBe('draft')
    expect(getGuiPlanPromptKind('Create plan: Add auth')).toBe('draft')
    expect(getGuiPlanPromptKind('Revise plan: Make it smaller')).toBe('refine')
    expect(getGuiPlanPromptKind('Build plan: .deepseekgui/plan/add-auth.md')).toBe('build')
    expect(isGuiPlanDraftOrRefinePrompt('Revise plan: Make it smaller')).toBe(true)
    expect(isGuiPlanDraftOrRefinePrompt('Build plan: .deepseekgui/plan/add-auth.md')).toBe(false)
  })

  it('builds refine prompts with the existing plan and feedback', () => {
    const prompt = buildRefinePlanPrompt({
      feedback: 'Make it smaller',
      currentPlan: '# Old',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.deepseekgui/plan/add-auth.md'
    })
    expect(prompt).toContain('overwrite')
    expect(prompt).toContain('create_plan')
    expect(prompt).toContain('Make it smaller')
    expect(prompt).toContain('# Old')
  })

  it('builds execution prompts that point at the plan file', () => {
    expect(buildPlanBuildPrompt('.deepseekgui/plan/add-auth.md')).toContain(
      'Please read and execute the GUI plan file at `.deepseekgui/plan/add-auth.md`'
    )
  })

  it('extracts tagged and fenced plan markdown', () => {
    expect(extractGuiPlanMarkdown('<gui_plan>\n# Plan\n</gui_plan>')).toBe('# Plan')
    expect(extractGuiPlanMarkdown('```markdown\n# Plan\n```')).toBe('# Plan')
  })

  it('extracts partial streaming tagged markdown', () => {
    expect(extractGuiPlanMarkdown('intro\n<gui_plan>\n# Streaming')).toBe('# Streaming')
  })
})
