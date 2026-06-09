import type { ThreadTodoItem, ThreadTodoList, ThreadTodoSource, ThreadTodoStatus } from '../agent/types'

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.+?)\s*$/

export function normalizeTodoContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function todoContentHash(value: string): string {
  const normalized = normalizeTodoContent(value).toLowerCase()
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function extractPlanTodos(input: {
  markdown: string
  threadId: string
  planId: string
  relativePath: string
  now: string
}): ThreadTodoItem[] {
  const items: ThreadTodoItem[] = []
  const lines = input.markdown.split(/\r?\n/)
  let ordinal = 0
  for (const line of lines) {
    const match = TASK_LINE_RE.exec(line)
    if (!match) continue
    const content = normalizeTodoContent(match[4] ?? '')
    if (!content) continue
    const contentHash = todoContentHash(content)
    const source: ThreadTodoSource = {
      kind: 'plan',
      planId: input.planId,
      relativePath: normalizePlanRelativePath(input.relativePath),
      ordinal,
      contentHash
    }
    items.push({
      id: makePlanTodoId(source),
      content,
      status: taskMarkerToStatus(match[2]),
      source,
      createdAt: input.now,
      updatedAt: input.now
    })
    ordinal += 1
  }
  return items
}

export function mergePlanTodosForRenderer(input: {
  threadId: string
  existing: ThreadTodoList | null
  planItems: ThreadTodoItem[]
  now: string
}): ThreadTodoList {
  const existingItems = input.existing?.items ?? []
  const usedExistingIds = new Set<string>()
  const nextItems: ThreadTodoItem[] = input.planItems.map((planItem) => {
    const existing = findExistingPlanTodo(existingItems, usedExistingIds, planItem)
    if (existing) usedExistingIds.add(existing.id)
    return {
      ...planItem,
      id: existing?.id ?? planItem.id,
      createdAt: existing?.createdAt ?? planItem.createdAt,
      updatedAt:
        existing && existing.content === planItem.content && existing.status === planItem.status
          ? existing.updatedAt
          : input.now
    }
  })

  for (const item of existingItems) {
    if (usedExistingIds.has(item.id)) continue
    if (item.source?.kind === 'plan') {
      nextItems.push({
        ...item,
        source: undefined,
        updatedAt: input.now
      })
    } else {
      nextItems.push(item)
    }
  }

  return {
    threadId: input.threadId,
    items: nextItems,
    updatedAt: input.now
  }
}

export function threadTodoWriteItems(
  todos: ThreadTodoList
): Array<Pick<ThreadTodoItem, 'id' | 'content' | 'status' | 'source'>> {
  return todos.items.map((item) => ({
    id: item.id,
    content: item.content,
    status: item.status,
    ...(item.source ? { source: item.source } : {})
  }))
}

export function sameTodoWriteItems(
  first: Array<Pick<ThreadTodoItem, 'id' | 'content' | 'status' | 'source'>>,
  second: Array<Pick<ThreadTodoItem, 'id' | 'content' | 'status' | 'source'>>
): boolean {
  if (first.length !== second.length) return false
  return first.every((item, index) => {
    const other = second[index]
    return Boolean(
      other &&
      item.id === other.id &&
      item.content === other.content &&
      item.status === other.status &&
      sameTodoSource(item.source, other.source)
    )
  })
}

function taskMarkerToStatus(marker: string | undefined): ThreadTodoStatus {
  return marker?.toLowerCase() === 'x' ? 'completed' : 'pending'
}

function normalizePlanRelativePath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '')
}

function makePlanTodoId(source: ThreadTodoSource): string {
  const base = `${source.planId}:${source.relativePath}:${source.ordinal}:${source.contentHash}`
  return `todo_plan_${todoContentHash(base)}`
}

function findExistingPlanTodo(
  existingItems: readonly ThreadTodoItem[],
  usedExistingIds: ReadonlySet<string>,
  planItem: ThreadTodoItem
): ThreadTodoItem | undefined {
  const source = planItem.source
  if (!source) return undefined
  const candidates = existingItems.filter((item) => !usedExistingIds.has(item.id))
  return (
    candidates.find((item) =>
      item.source?.kind === 'plan' &&
      item.source.planId === source.planId &&
      item.source.relativePath === source.relativePath &&
      item.source.contentHash === source.contentHash
    ) ??
    candidates.find((item) =>
      item.source?.kind === 'plan' &&
      item.source.relativePath === source.relativePath &&
      item.source.contentHash === source.contentHash
    ) ??
    candidates.find((item) => todoContentHash(item.content) === source.contentHash) ??
    candidates.find((item) =>
      item.source?.kind === 'plan' &&
      item.source.planId === source.planId &&
      item.source.relativePath === source.relativePath &&
      item.source.ordinal === source.ordinal
    )
  )
}

function sameTodoSource(
  first: ThreadTodoSource | undefined,
  second: ThreadTodoSource | undefined
): boolean {
  if (!first || !second) return !first && !second
  return (
    first.kind === second.kind &&
    first.planId === second.planId &&
    first.relativePath === second.relativePath &&
    first.ordinal === second.ordinal &&
    first.contentHash === second.contentHash
  )
}
