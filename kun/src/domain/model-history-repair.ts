import type { TurnItem } from '../contracts/items.js'

/**
 * Repairs persisted turn items into a model-sendable history shape.
 *
 * Kun stores GUI-only items such as approvals, user input prompts, and
 * reasoning blocks beside model-bound tool calls. Provider APIs are stricter:
 * every assistant tool-call block must be followed by exactly one matching
 * result per call, with only model-ignored bridge items in between.
 */
export function repairModelHistoryItems(items: TurnItem[]): TurnItem[] {
  const keptCallIndexes = new Set<number>()
  const keptResultIndexes = new Set<number>()

  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (item?.kind !== 'tool_call') {
      index += 1
      continue
    }

    const calls: Array<{ item: Extract<TurnItem, { kind: 'tool_call' }>; index: number }> = []
    const seenCallIds = new Set<string>()
    let cursor = index
    while (cursor < items.length && items[cursor]?.kind === 'tool_call') {
      const call = items[cursor] as Extract<TurnItem, { kind: 'tool_call' }>
      if (!seenCallIds.has(call.callId)) {
        seenCallIds.add(call.callId)
        calls.push({ item: call, index: cursor })
      }
      cursor += 1
    }

    const result = findResultBlock(items, cursor, {
      turnId: item.turnId,
      expectedCallIds: seenCallIds
    })
    if (calls.length > 0 && result.resultCallIds.size > 0) {
      for (const call of calls) {
        if (result.resultCallIds.has(call.item.callId)) keptCallIndexes.add(call.index)
      }
      for (const resultIndex of result.resultIndexes) keptResultIndexes.add(resultIndex)
    }

    index = cursor
  }

  let changed = false
  const repaired = items.filter((item, itemIndex) => {
    if (item.kind === 'tool_call') {
      const keep = keptCallIndexes.has(itemIndex)
      changed ||= !keep
      return keep
    }
    if (item.kind === 'tool_result') {
      const keep = keptResultIndexes.has(itemIndex)
      changed ||= !keep
      return keep
    }
    return true
  })
  return changed ? repaired : items
}

function findResultBlock(
  items: TurnItem[],
  startIndex: number,
  options: { turnId: string; expectedCallIds: Set<string> }
): { resultCallIds: Set<string>; resultIndexes: number[] } {
  const seenResultIds = new Set<string>()
  const resultIndexes: number[] = []
  let sawResult = false
  let index = startIndex

  while (index < items.length) {
    const item = items[index]
    if (!item) break
    if (item.kind === 'tool_result') {
      sawResult = true
      if (options.expectedCallIds.has(item.callId) && !seenResultIds.has(item.callId)) {
        seenResultIds.add(item.callId)
        resultIndexes.push(index)
      }
      index += 1
      continue
    }
    if (isToolResultBridgeItem(item, { turnId: options.turnId, sawResult })) {
      index += 1
      continue
    }
    break
  }

  return { resultCallIds: seenResultIds, resultIndexes }
}

export function isToolResultBridgeItem(
  item: TurnItem,
  options: { turnId: string; sawResult: boolean }
): boolean {
  switch (item.kind) {
    case 'assistant_reasoning':
    case 'approval':
    case 'user_input':
    case 'error':
      return true
    case 'assistant_text':
      return !options.sawResult && item.turnId === options.turnId
    default:
      return false
  }
}
