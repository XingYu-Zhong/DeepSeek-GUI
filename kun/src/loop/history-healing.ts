import type { TurnItem } from '../contracts/items.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'

export type HistoryHealingResult = {
  items: TurnItem[]
  changed: boolean
}

export function healLoadedHistoryItems(items: readonly TurnItem[]): HistoryHealingResult {
  const normalized = items
    .map((item, index) => normalizeLoadedItem(item, index))
    .filter((item): item is TurnItem => item !== null)
  const repaired = repairModelHistoryItems(normalized)
  return {
    items: repaired,
    changed: JSON.stringify(items) !== JSON.stringify(repaired)
  }
}

function normalizeLoadedItem(item: TurnItem, index: number): TurnItem | null {
  if (!item || typeof item !== 'object') return null
  const candidate = item as TurnItem & Record<string, unknown>
  const kind = typeof candidate.kind === 'string' ? candidate.kind : ''
  if (!kind) return null
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? candidate.id
    : `item_healed_${index}_${kind}`
  const base = { ...candidate, id } as TurnItem
  switch (kind) {
    case 'tool_call':
      if (!candidate.callId || !candidate.toolName) return null
      return base
    case 'tool_result':
      if (!candidate.callId || !candidate.toolName) return null
      return base
    case 'assistant_text':
    case 'assistant_reasoning':
    case 'user_message':
    case 'approval':
    case 'user_input':
    case 'compaction':
    case 'review':
    case 'error':
      return base
    default:
      return null
  }
}
