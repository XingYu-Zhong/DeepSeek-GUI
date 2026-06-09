import { describe, expect, it } from 'vitest'
import { parseGuiPlanCommand } from './plan-command'

describe('plan-command', () => {
  it('parses open commands', () => {
    expect(parseGuiPlanCommand('/plan')).toEqual({ kind: 'open' })
    expect(parseGuiPlanCommand('  /plan  ')).toEqual({ kind: 'open' })
  })

  it('parses create commands with a request', () => {
    expect(parseGuiPlanCommand('/plan build login page')).toEqual({
      kind: 'create',
      request: 'build login page'
    })
  })

  it('ignores non-plan input and adjacent command names', () => {
    expect(parseGuiPlanCommand('please /plan this')).toBeNull()
    expect(parseGuiPlanCommand('/planet')).toBeNull()
  })
})
