import { z } from 'zod'
import {
  CreateThreadRequest,
  ClearThreadGoalResponse,
  ClearThreadTodosResponse,
  DeleteThreadResponse,
  ForkThreadRequest,
  ListThreadsResponse,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  ThreadGoalResponse,
  ThreadSchema,
  ThreadTodosResponse,
  UpdateThreadRequest,
  type ThreadRecord
} from '../../contracts/threads.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { ForkThreadOptions, ListThreadsOptions, ThreadService } from '../../services/thread-service.js'
import type { RuntimeError } from './runtime-error.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { Turn } from '../../contracts/turns.js'
import type { TurnItem } from '../../contracts/items.js'

/**
 * Handlers for the thread CRUD endpoints. The handlers accept a
 * pre-validated body when possible and otherwise parse it through
 * the contract Zod schema. Validation failures return HTTP 400.
 */
const BooleanQuery = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return value
}, z.boolean())

const ListThreadsQuery = z.object({
  limit: z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    return Number(value)
  }, z.number().int().positive().max(500).optional()),
  search: z.string().optional(),
  include_archived: BooleanQuery.optional(),
  archived_only: BooleanQuery.optional(),
  /**
   * Comma-separated list of additional categories to include. Currently
   * the only opt-in category is `side` (side conversations are hidden
   * from the default listing).
   */
  include: z.string().optional()
})

export async function listThreads(
  service: ThreadService,
  request: Request
): Promise<JsonResponse> {
  const parsed = parseListThreadsOptions(request)
  if (!parsed.ok) return parsed.response
  const threads = await service.list(parsed.options)
  const payload: ListThreadsResponse = { threads }
  return jsonResponse(payload)
}

export async function createThread(
  service: ThreadService,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = CreateThreadRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid create thread body', parsed.error.issues)
  }
  const thread = await service.create(parsed.data)
  return jsonResponse(ThreadSchema.parse(thread), 201)
}

export async function getThread(
  service: ThreadService,
  threadId: string,
  sessionStore?: SessionStore
): Promise<JsonResponse> {
  const thread = await service.get(threadId)
  if (!thread) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  let latestSeq = 0
  let sessionItems: TurnItem[] = []
  if (sessionStore) {
    [latestSeq, sessionItems] = await Promise.all([
      sessionStore.highestSeq(threadId),
      sessionStore.loadItems(threadId)
    ])
  }
  const hydratedThread = hydrateThreadItemsFromSession(thread, sessionItems)
  return jsonResponse({
    ...ThreadSchema.parse(hydratedThread),
    latestSeq
  })
}

function hydrateThreadItemsFromSession(thread: ThreadRecord, items: TurnItem[]): ThreadRecord {
  if (items.length === 0 || thread.turns.length === 0) return thread
  const itemsByTurn = new Map<string, TurnItem[]>()
  for (const item of items) {
    const turnItems = itemsByTurn.get(item.turnId) ?? []
    turnItems.push(item)
    itemsByTurn.set(item.turnId, turnItems)
  }
  let changed = false
  const turns = thread.turns.map((turn): Turn => {
    const sessionTurnItems = itemsByTurn.get(turn.id)
    if (!sessionTurnItems) return turn
    changed = true
    return { ...turn, items: sessionTurnItems }
  })
  return changed ? { ...thread, turns } : thread
}

export async function updateThread(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = UpdateThreadRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid update thread body', parsed.error.issues)
  }
  try {
    const updated: ThreadRecord = await service.update(threadId, parsed.data)
    return jsonResponse(ThreadSchema.parse(updated))
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function deleteThread(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  const ok = await service.delete(threadId)
  if (!ok) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  const payload: DeleteThreadResponse = { id: threadId, deleted: true }
  return jsonResponse(payload)
}

export async function forkThread(
  service: ThreadService,
  threadId: string,
  request?: Request
): Promise<JsonResponse> {
  let options: ForkThreadOptions = {}
  if (request) {
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = ForkThreadRequest.safeParse(body.value)
    if (!parsed.success) {
      return validationError('invalid fork thread body', parsed.error.issues)
    }
    options = parsed.data ?? {}
  }
  try {
    const fork = await service.fork(threadId, options)
    return jsonResponse(ThreadSchema.parse(fork), 201)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function getThreadGoal(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ThreadGoalResponse = { goal: await service.getGoal(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function setThreadGoal(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SetThreadGoalRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid thread goal body', parsed.error.issues)
  }
  try {
    const payload: ThreadGoalResponse = { goal: await service.setGoal(threadId, parsed.data) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    if (error instanceof Error && /no goal exists/i.test(error.message)) {
      return jsonResponse(
        { code: 'validation_error', message: error.message },
        400
      )
    }
    throw error
  }
}

export async function clearThreadGoal(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ClearThreadGoalResponse = { cleared: await service.clearGoal(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function getThreadTodos(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ThreadTodosResponse = { todos: await service.getTodos(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

export async function setThreadTodos(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SetThreadTodosRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid thread todos body', parsed.error.issues)
  }
  try {
    const payload: ThreadTodosResponse = { todos: await service.setTodos(threadId, parsed.data) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    if (error instanceof Error && /todo|plan|in_progress|content/i.test(error.message)) {
      return jsonResponse(
        { code: 'validation_error', message: error.message },
        400
      )
    }
    throw error
  }
}

export async function clearThreadTodos(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  try {
    const payload: ClearThreadTodosResponse = { cleared: await service.clearTodos(threadId) }
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse(
        { code: 'not_found', message: error.message },
        404
      )
    }
    throw error
  }
}

function validationError(message: string, issues: unknown): JsonResponse {
  const body: RuntimeError = {
    code: 'validation_error',
    message,
    details: issues
  }
  return jsonResponse(body, 400)
}

// Re-export for tests
export const _internal = { readJsonBody, parseListThreadsOptions }

function parseListThreadsOptions(
  request: Request
): { ok: true; options: ListThreadsOptions } | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const parsed = ListThreadsQuery.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return {
      ok: false,
      response: validationError('invalid list threads query', parsed.error.issues)
    }
  }
  const includeSide = (parsed.data.include ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes('side')
  return {
    ok: true,
    options: {
      limit: parsed.data.limit,
      search: parsed.data.search,
      includeArchived: parsed.data.include_archived,
      archivedOnly: parsed.data.archived_only,
      includeSide
    }
  }
}

void z
