import { z } from 'zod'
import type { ThreadService } from '../../services/thread-service.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { RuntimeError } from './runtime-error.js'

const ResumeSessionRequest = z.object({
  workspace: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  mode: z.enum(['agent', 'plan']).optional()
})

export async function resumeSession(
  service: ThreadService,
  sessionId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = ResumeSessionRequest.safeParse(body.value)
  if (!parsed.success) {
    return validationError('invalid resume session body', parsed.error.issues)
  }
  try {
    const result = await service.resumeSession(sessionId, parsed.data)
    return jsonResponse(
      {
        thread_id: result.thread.id,
        session_id: result.sessionId,
        message_count: result.messageCount,
        summary: result.thread.title
      },
      201
    )
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
