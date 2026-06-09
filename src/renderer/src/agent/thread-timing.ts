export type RuntimeTurnRecord = {
  id: string
  item_ids?: string[]
  created_at?: string | null
  started_at?: string | null
  ended_at?: string | null
}

export type RuntimeTurnItem = {
  id: string
  turn_id?: string
  kind: string
  started_at?: string | null
  ended_at?: string | null
}

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function itemTimestampMs(item: RuntimeTurnItem): number | undefined {
  return parseTimestampMs(item.started_at) ?? parseTimestampMs(item.ended_at)
}

function durationFromRange(startedAt: number | undefined, endedAt: number | undefined): number | undefined {
  if (typeof startedAt !== 'number' || typeof endedAt !== 'number') return undefined
  const duration = endedAt - startedAt
  return duration >= 0 && Number.isFinite(duration) ? duration : undefined
}

export function buildTurnDurationByUserId(
  turns: readonly RuntimeTurnRecord[] | undefined,
  items: readonly RuntimeTurnItem[]
): Record<string, number> {
  if (!turns?.length || items.length === 0) return {}

  const itemsById = new Map(items.map((item) => [item.id, item]))
  const turnIdByItemId = new Map<string, string>()
  for (const turn of turns) {
    for (const itemId of turn.item_ids ?? []) {
      turnIdByItemId.set(itemId, turn.id)
    }
  }

  const userIdByTurnId = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== 'user_message') continue
    const turnId = item.turn_id ?? turnIdByItemId.get(item.id)
    if (turnId && !userIdByTurnId.has(turnId)) {
      userIdByTurnId.set(turnId, item.id)
    }
  }

  const durations: Record<string, number> = {}
  for (const turn of turns) {
    const userId = userIdByTurnId.get(turn.id)
    if (!userId) continue

    const turnItems = (turn.item_ids ?? [])
      .map((itemId) => itemsById.get(itemId))
      .filter((item): item is RuntimeTurnItem => Boolean(item))
    const firstItemStartedAt = turnItems
      .map(itemTimestampMs)
      .filter((ms): ms is number => typeof ms === 'number')
      .sort((a, b) => a - b)[0]
    const lastItemEndedAt = turnItems
      .map((item) => parseTimestampMs(item.ended_at) ?? itemTimestampMs(item))
      .filter((ms): ms is number => typeof ms === 'number')
      .sort((a, b) => b - a)[0]

    const duration = durationFromRange(
      parseTimestampMs(turn.started_at) ?? parseTimestampMs(turn.created_at) ?? firstItemStartedAt,
      parseTimestampMs(turn.ended_at) ?? lastItemEndedAt
    )
    if (typeof duration === 'number') durations[userId] = duration
  }

  return durations
}
