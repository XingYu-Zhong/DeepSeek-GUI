import {
  CompactRequest,
  InterruptTurnRequest,
  InterruptTurnResponse,
  StartTurnRequest,
  StartTurnResponse,
  SteerTurnRequest,
  TurnSchema
} from '../../contracts/turns.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import type { TurnService } from '../../services/turn-service.js'

export async function startTurn(
  turns: TurnService,
  threadId: string,
  request: Request,
  onStarted?: (response: StartTurnResponse) => void
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = StartTurnRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid start turn body', parsed.error.issues)
  }
  try {
    const response: StartTurnResponse = await turns.startTurn({
      threadId,
      request: parsed.data
    })
    onStarted?.(response)
    return jsonResponse(response, 202)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return ERRORS.notFound(error.message)
    }
    throw error
  }
}

export async function steerTurn(
  turns: TurnService,
  threadId: string,
  turnId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SteerTurnRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid steer turn body', parsed.error.issues)
  }
  await turns.steerTurn({ threadId, turnId, text: parsed.data.text })
  return jsonResponse({ ok: true })
}

export async function interruptTurn(
  turns: TurnService,
  threadId: string,
  turnId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = InterruptTurnRequest.safeParse(body.value ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid interrupt turn body', parsed.error.issues)
  }
  const result = await turns.interruptTurn({ threadId, turnId, discard: parsed.data.discard })
  const payload: InterruptTurnResponse = {
    threadId,
    turnId,
    status: result.status
  }
  return jsonResponse(payload)
}

export async function compactTurn(
  turns: TurnService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = CompactRequest.safeParse(body.value ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid compact body', parsed.error.issues)
  }
  try {
    const response = await turns.compact({
      threadId,
      request: parsed.data
    })
    return jsonResponse(response)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return ERRORS.notFound(error.message)
    }
    throw error
  }
}

export async function getTurn(
  turns: TurnService,
  threadId: string,
  turnId: string
): Promise<JsonResponse> {
  const turn = await turns.getTurn(threadId, turnId)
  if (!turn) {
    return jsonResponse(
      { code: 'not_found', message: `turn not found: ${turnId}` },
      404
    )
  }
  return jsonResponse(TurnSchema.parse(turn))
}
