import {
  reviewTargetPrompt,
  reviewTargetTitle,
  StartReviewRequest,
  type StartReviewResponse
} from '../../contracts/review.js'
import { makeReviewItem } from '../../domain/item.js'
import type { TurnService } from '../../services/turn-service.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

export async function startReview(
  turns: TurnService,
  threadId: string,
  request: Request,
  onStarted?: (response: StartReviewResponse, target: StartReviewRequest['target'], model?: string) => void
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = StartReviewRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid review body', parsed.error.issues)
  }
  const title = reviewTargetTitle(parsed.data.target)
  try {
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: reviewTargetPrompt(parsed.data.target),
        displayText: title,
        model: parsed.data.model,
        mode: 'agent'
      }
    })
    const reviewItemId = `item_${started.turnId}_review`
    await turns.applyItem(
      threadId,
      makeReviewItem({
        id: reviewItemId,
        threadId,
        turnId: started.turnId,
        target: parsed.data.target,
        title,
        status: 'running'
      })
    )
    const response: StartReviewResponse = {
      ...started,
      reviewItemId
    }
    onStarted?.(response, parsed.data.target, parsed.data.model)
    return jsonResponse(response, 202)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return ERRORS.notFound(error.message)
    }
    throw error
  }
}
