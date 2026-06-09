import type { ChatBlock } from '../agent/types'
import { GUI_PLAN_CREATE_PLAN_TOOL_NAME } from '@shared/gui-plan'

/**
 * Native Kun plan tool names the Workbench recognises. The set is
 * intentionally small: any tool other than the native `create_plan` is
 * treated as unrelated to the GUI plan workflow.
 */
const GUI_PLAN_TOOL_NAMES = new Set<string>([GUI_PLAN_CREATE_PLAN_TOOL_NAME])

function toolBlockMeta(block: Extract<ChatBlock, { kind: 'tool' }>): Record<string, unknown> {
  return (block.meta as Record<string, unknown> | undefined) ?? {}
}

function toolBlockToolName(block: Extract<ChatBlock, { kind: 'tool' }>): string | undefined {
  const meta = toolBlockMeta(block)
  const toolName = (meta as { toolName?: unknown }).toolName
  return typeof toolName === 'string' ? toolName : undefined
}

function toolBlockHasPlan(block: Extract<ChatBlock, { kind: 'tool' }>): boolean {
  const meta = toolBlockMeta(block) as { plan?: unknown }
  return Boolean(meta.plan && typeof meta.plan === 'object')
}

export function isGuiPlanToolBlock(block: ChatBlock): boolean {
  if (block.kind !== 'tool') return false
  const name = toolBlockToolName(block)
  if (name && GUI_PLAN_TOOL_NAMES.has(name)) return true
  return toolBlockHasPlan(block)
}

export function hasSuccessfulGuiPlanToolCall(blocks: ChatBlock[], startIndex: number): boolean {
  for (let index = Math.max(0, startIndex); index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!isGuiPlanToolBlock(block)) continue
    if (block.kind === 'tool' && block.status === 'success') return true
  }
  return false
}

/**
 * Extract the structured plan metadata from a successful `create_plan`
 * tool block, or `null` if the block does not contain plan metadata.
 */
export function extractPlanMetadataFromBlock(
  block: ChatBlock
): {
  planId: string
  workspaceRoot: string
  relativePath: string
  absolutePath?: string
  operation: 'draft' | 'refine'
  savedAt?: string
  contentHash?: string
  byteSize?: number
  sourceRequest?: string
  title?: string
} | null {
  if (block.kind !== 'tool') return null
  const meta = toolBlockMeta(block) as {
    plan?: Record<string, unknown>
    toolName?: string
  }
  if (!meta.plan) return null
  if (meta.toolName && !GUI_PLAN_TOOL_NAMES.has(meta.toolName)) return null
  const plan = meta.plan
  const planId = typeof plan.plan_id === 'string' ? plan.plan_id : ''
  const workspaceRoot = typeof plan.workspace_root === 'string' ? plan.workspace_root : ''
  const relativePath = typeof plan.relative_path === 'string' ? plan.relative_path : ''
  const operation = plan.operation === 'draft' || plan.operation === 'refine' ? plan.operation : null
  if (!planId || !workspaceRoot || !relativePath || !operation) return null
  return {
    planId,
    workspaceRoot,
    relativePath,
    absolutePath: typeof plan.absolute_path === 'string' ? plan.absolute_path : undefined,
    operation,
    savedAt: typeof plan.saved_at === 'string' ? plan.saved_at : undefined,
    contentHash: typeof plan.content_hash === 'string' ? plan.content_hash : undefined,
    byteSize: typeof plan.byte_size === 'number' ? plan.byte_size : undefined,
    sourceRequest: typeof plan.source_request === 'string' ? plan.source_request : undefined,
    title: typeof plan.title === 'string' ? plan.title : undefined
  }
}
