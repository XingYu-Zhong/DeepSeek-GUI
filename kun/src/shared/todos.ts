import type {
  ThreadTodoItem,
  ThreadTodoList,
  ThreadTodoSource,
  ThreadTodoStatus
} from '../contracts/threads.js'

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.+?)\s*$/

export type ExtractedPlanTodo = ThreadTodoItem & {
  source: ThreadTodoSource
}

export type MergePlanTodosOptions = {
  threadId: string
  existing: ThreadTodoList | null | undefined
  planItems: readonly ExtractedPlanTodo[]
  now: string
  preserveCompleted?: boolean
}

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

export function makePlanTodoId(input: {
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}): string {
  const base = `${input.planId}:${input.relativePath}:${input.ordinal}:${input.contentHash}`
  return `todo_plan_${todoContentHash(base)}`
}

export function extractPlanTodos(input: {
  markdown: string
  planId: string
  relativePath: string
  threadId: string
  now: string
}): ExtractedPlanTodo[] {
  const items: ExtractedPlanTodo[] = []
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

export function mergePlanTodos(options: MergePlanTodosOptions): ThreadTodoList {
  const existingItems = options.existing?.items ?? []
  const usedExistingIds = new Set<string>()
  const nextItems: ThreadTodoItem[] = []

  for (const planItem of options.planItems) {
    const existing = findExistingPlanTodo(existingItems, usedExistingIds, planItem)
    if (existing) usedExistingIds.add(existing.id)
    const status =
      existing && options.preserveCompleted && existing.status === 'completed'
        ? existing.status
        : existing?.status ?? planItem.status
    nextItems.push({
      ...planItem,
      id: existing?.id ?? planItem.id,
      status,
      createdAt: existing?.createdAt ?? planItem.createdAt,
      updatedAt:
        existing && existing.content === planItem.content && existing.status === status
          ? existing.updatedAt
          : options.now
    })
  }

  for (const item of existingItems) {
    if (usedExistingIds.has(item.id)) continue
    if (item.source?.kind === 'plan') {
      nextItems.push({
        ...item,
        source: undefined,
        updatedAt: options.now
      })
    } else {
      nextItems.push(item)
    }
  }

  return {
    threadId: options.threadId,
    items: nextItems,
    updatedAt: options.now
  }
}

export function patchPlanTodoStatus(
  markdown: string,
  item: Pick<ThreadTodoItem, 'status' | 'source' | 'content'>
): { markdown: string; changed: boolean } {
  const source = item.source
  if (!source || source.kind !== 'plan') return { markdown, changed: false }
  const lines = markdown.split(/\r?\n/)
  const lineEnding = markdown.includes('\r\n') ? '\r\n' : '\n'
  const tasks = lines
    .map((line, lineIndex) => ({ line, lineIndex, match: TASK_LINE_RE.exec(line) }))
    .filter((entry): entry is { line: string; lineIndex: number; match: RegExpExecArray } =>
      Boolean(entry.match)
    )
    .map((entry, ordinal) => ({
      ...entry,
      ordinal,
      content: normalizeTodoContent(entry.match[4] ?? ''),
      contentHash: todoContentHash(entry.match[4] ?? '')
    }))

  const target =
    tasks.find((task) => task.ordinal === source.ordinal && task.contentHash === source.contentHash) ??
    tasks.find((task) => task.contentHash === source.contentHash) ??
    tasks.find((task) => task.ordinal === source.ordinal)
  if (!target) return { markdown, changed: false }

  const marker = item.status === 'completed' ? 'x' : ' '
  const currentMarker = target.match[2] ?? ' '
  if (currentMarker.toLowerCase() === marker) return { markdown, changed: false }
  lines[target.lineIndex] = target.line.replace(TASK_LINE_RE, `$1${marker}$3$4`)
  return { markdown: lines.join(lineEnding), changed: true }
}

export function sourceKey(source: ThreadTodoSource): string {
  return `${source.kind}:${source.planId}:${source.relativePath}:${source.ordinal}:${source.contentHash}`
}

export function normalizePlanRelativePath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '')
}

function taskMarkerToStatus(marker: string | undefined): ThreadTodoStatus {
  return marker?.toLowerCase() === 'x' ? 'completed' : 'pending'
}

function findExistingPlanTodo(
  existingItems: readonly ThreadTodoItem[],
  usedExistingIds: ReadonlySet<string>,
  planItem: ExtractedPlanTodo
): ThreadTodoItem | undefined {
  const candidates = existingItems.filter((item) => !usedExistingIds.has(item.id))
  return (
    candidates.find((item) =>
      item.source?.kind === 'plan' &&
      item.source.planId === planItem.source.planId &&
      item.source.relativePath === planItem.source.relativePath &&
      item.source.contentHash === planItem.source.contentHash
    ) ??
    candidates.find((item) =>
      item.source?.kind === 'plan' &&
      item.source.relativePath === planItem.source.relativePath &&
      item.source.contentHash === planItem.source.contentHash
    ) ??
    candidates.find((item) => todoContentHash(item.content) === planItem.source.contentHash) ??
    candidates.find((item) =>
      item.source?.kind === 'plan' &&
      item.source.planId === planItem.source.planId &&
      item.source.relativePath === planItem.source.relativePath &&
      item.source.ordinal === planItem.source.ordinal
    )
  )
}
