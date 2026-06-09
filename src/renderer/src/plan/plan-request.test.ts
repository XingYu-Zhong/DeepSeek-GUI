import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { isInternalGuiPlanPrompt, latestUserRequestForGuiPlan } from './plan-request'

describe('plan-request', () => {
  it('returns the latest real user request', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'u1', text: 'first request' },
      { kind: 'assistant', id: 'a1', text: 'answer' },
      { kind: 'user', id: 'u2', text: 'build the dashboard' }
    ]
    expect(latestUserRequestForGuiPlan(blocks)).toBe('build the dashboard')
  })

  it('skips internal GUI plan prompts', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'u1', text: 'make auth nicer' },
      {
        kind: 'user',
        id: 'u2',
        text: 'DeepSeek GUI is asking you to draft a GUI-owned implementation plan.'
      },
      {
        kind: 'user',
        id: 'u3',
        text: 'Please read and execute the GUI plan file at `.deepseekgui/plan/auth.md`'
      },
      {
        kind: 'user',
        id: 'u4',
        text: 'Create plan: auth'
      }
    ]
    expect(latestUserRequestForGuiPlan(blocks)).toBe('make auth nicer')
  })

  it('recognizes internal plan prompts', () => {
    expect(isInternalGuiPlanPrompt('DeepSeek GUI is asking you to revise an existing GUI-owned implementation plan.')).toBe(true)
    expect(isInternalGuiPlanPrompt('Please read and execute the GUI plan file at `.deepseekgui/plan/a.md`')).toBe(true)
    expect(isInternalGuiPlanPrompt('Create plan: auth')).toBe(true)
    expect(isInternalGuiPlanPrompt('please make a plan for auth')).toBe(false)
  })
})
