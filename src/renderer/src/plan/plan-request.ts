import type { ChatBlock } from '../agent/types'
import { isGuiPlanInternalPrompt } from './plan-prompts'

export function isInternalGuiPlanPrompt(text: string): boolean {
  return isGuiPlanInternalPrompt(text)
}

export function latestUserRequestForGuiPlan(blocks: ChatBlock[]): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.kind !== 'user') continue
    const text = block.text.trim()
    if (!text || isInternalGuiPlanPrompt(text)) continue
    return text
  }
  return ''
}
