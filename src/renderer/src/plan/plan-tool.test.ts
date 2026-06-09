import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { extractPlanMetadataFromBlock, hasSuccessfulGuiPlanToolCall, isGuiPlanToolBlock } from './plan-tool'
import { GUI_PLAN_CREATE_PLAN_TOOL_NAME } from '@shared/gui-plan'

function toolBlock(overrides: Partial<Extract<ChatBlock, { kind: 'tool' }>>): ChatBlock {
  return {
    kind: 'tool',
    id: 'item_tool_1',
    summary: 'Create plan',
    status: 'success',
    toolKind: 'tool_call',
    meta: { toolName: GUI_PLAN_CREATE_PLAN_TOOL_NAME },
    ...overrides
  }
}

describe('plan-tool helpers', () => {
  it('recognises a create_plan tool block by meta.toolName', () => {
    const block = toolBlock({})
    expect(isGuiPlanToolBlock(block)).toBe(true)
  })

  it('recognises a create_plan tool block by meta.plan even when toolName is missing', () => {
    const block = toolBlock({
      meta: {
        plan: {
          plan_id: 'p1',
          workspace_root: '/tmp/ws',
          relative_path: '.deepseekgui/plan/x.md',
          operation: 'draft'
        }
      }
    })
    expect(isGuiPlanToolBlock(block)).toBe(true)
  })

  it('ignores non-plan tool blocks', () => {
    const block: ChatBlock = {
      kind: 'tool',
      id: 'item_other',
      summary: 'shell',
      status: 'success',
      meta: { toolName: 'bash' }
    }
    expect(isGuiPlanToolBlock(block)).toBe(false)
  })

  it('extracts plan metadata from a successful create_plan tool result', () => {
    const block = toolBlock({
      meta: {
        toolName: GUI_PLAN_CREATE_PLAN_TOOL_NAME,
        plan: {
          plan_id: '/tmp/ws:.deepseekgui/plan/login.md',
          workspace_root: '/tmp/ws',
          relative_path: '.deepseekgui/plan/login.md',
          absolute_path: '/tmp/ws/.deepseekgui/plan/login.md',
          operation: 'draft',
          saved_at: '2024-01-01T00:00:00.000Z',
          content_hash: 'deadbeef',
          byte_size: 42
        }
      }
    })
    const meta = extractPlanMetadataFromBlock(block)
    expect(meta).toEqual({
      planId: '/tmp/ws:.deepseekgui/plan/login.md',
      workspaceRoot: '/tmp/ws',
      relativePath: '.deepseekgui/plan/login.md',
      absolutePath: '/tmp/ws/.deepseekgui/plan/login.md',
      operation: 'draft',
      savedAt: '2024-01-01T00:00:00.000Z',
      contentHash: 'deadbeef',
      byteSize: 42,
      sourceRequest: undefined,
      title: undefined
    })
  })

  it('returns null for tool blocks without structured plan metadata', () => {
    const block: ChatBlock = {
      kind: 'tool',
      id: 'item_orphan',
      summary: 'shell',
      status: 'success',
      meta: { toolName: 'bash' }
    }
    expect(extractPlanMetadataFromBlock(block)).toBeNull()
  })

  it('hasSuccessfulGuiPlanToolCall ignores earlier turns and includes the pending one', () => {
    const blocks: ChatBlock[] = [
      toolBlock({ id: 'older', status: 'success' }),
      { kind: 'user', id: 'u1', text: 'hi' },
      { kind: 'assistant', id: 'a1', text: 'planning...' },
      toolBlock({ id: 'fresh', status: 'success' })
    ]
    expect(hasSuccessfulGuiPlanToolCall(blocks, 1)).toBe(true)
  })
})
