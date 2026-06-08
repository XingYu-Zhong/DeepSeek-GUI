import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay,
} from '../../lib/diff-stats'
import {
  isProcessBlock,
  splitThink,
  type Turn
} from './message-timeline-turns'

export type TurnAssistantBlock = Extract<ChatBlock, { kind: 'assistant' }>

export type TurnSections = {
  processBlocks: ChatBlock[]
  assistantContentBlocks: TurnAssistantBlock[]
  turnFileChanges: ToolBlock[]
}

type DeriveTurnSectionsInput = {
  turn: Turn
  isProcessing: boolean
  liveProcessText: string
  liveContent: string
  workspaceRoot: string
}

/**
 * Pure derivation of a turn's three view slices:
 *  - `processBlocks`: chronological reasoning/tool/compaction/approval
 *    trace, including in-flight assistant output while a turn is processing.
 *  - `assistantContentBlocks`: assistant content that should render as the
 *    visible message body once it is no longer part of the active work timeline.
 *  - `turnFileChanges`: successful file_change tool blocks whose detail
 *    is a unified diff, with paths normalised for display.
 *
 * Pulled out of `MessageTurn` so the derivation is testable in isolation
 * and the component body stays focused on rendering.
 */
export function deriveTurnSections({
  turn,
  isProcessing,
  liveProcessText,
  liveContent,
  workspaceRoot
}: DeriveTurnSectionsInput): TurnSections {
  const processBlocks: ChatBlock[] = []
  const assistantContentBlocks: TurnAssistantBlock[] = []
  let latestAssistantContentBlock: TurnAssistantBlock | null = null

  for (const block of turn.blocks) {
    if (block.kind === 'assistant') {
      const split = splitThink(block.text)
      if (split.think) {
        processBlocks.push({ kind: 'reasoning', id: `${block.id}-think`, text: split.think })
      }
      if (split.content.trim()) {
        const contentBlock: TurnAssistantBlock = { ...block, text: split.content }
        latestAssistantContentBlock = contentBlock
        if (isProcessing) {
          processBlocks.push(contentBlock)
        } else {
          assistantContentBlocks.push(contentBlock)
        }
      }
      continue
    }
    if (isProcessBlock(block)) {
      processBlocks.push(block)
    }
  }

  if (!isProcessing && assistantContentBlocks.length === 0 && latestAssistantContentBlock) {
    assistantContentBlocks.push(latestAssistantContentBlock)
  }

  if (liveProcessText.trim()) {
    processBlocks.push({ kind: 'reasoning', id: 'live-reasoning', text: liveProcessText })
  }
  if (isProcessing && liveContent.trim()) {
    const liveText = liveContent.trim()
    const latestText = latestAssistantContentBlock?.text.trim() ?? ''
    if (liveText !== latestText) {
      processBlocks.push({
        kind: 'assistant',
        id: 'live-assistant',
        text: liveContent
      } satisfies TurnAssistantBlock)
    }
  }

  const turnFileChanges: ToolBlock[] = isProcessing
    ? []
    : turn.blocks.flatMap((block): ToolBlock[] => {
        if (
          !(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')
        ) {
          return []
        }

        const detailText = extractUnifiedDiffText(block.detail)
        if (!detailText) return []

        const resolvedFilePath = formatFilePathForDisplay(
          extractDiffFilePath(detailText, block.filePath),
          workspaceRoot
        )
        if (!resolvedFilePath) return []

        return [{ ...block, detail: detailText, filePath: resolvedFilePath }]
      })

  return { processBlocks, assistantContentBlocks, turnFileChanges }
}
