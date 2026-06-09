import { describe, expect, it } from 'vitest'
import { clawDefaultAgentName } from './SidebarClawDialogHelpers'

describe('SidebarClawDialogHelpers', () => {
  it('uses product default agent names for phone providers', () => {
    expect(clawDefaultAgentName('feishu')).toBe('feishu agent')
    expect(clawDefaultAgentName('lark')).toBe('lark agent')
    expect(clawDefaultAgentName('weixin')).toBe('weixin agent')
  })
})
