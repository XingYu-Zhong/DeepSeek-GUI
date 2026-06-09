import type { KunErrorBody } from '../contracts/errors.js'
import { jsonResponse, type JsonResponse } from './response.js'

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: JsonResponse }

export async function readJsonBody(request: Request): Promise<ReadJsonBodyResult> {
  if (request.body === null) return { ok: true, value: {} }
  const text = await request.text()
  if (!text) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const body: KunErrorBody = {
      code: 'validation_error',
      message: 'invalid JSON body',
      details: error instanceof Error ? error.message : String(error)
    }
    return { ok: false, response: jsonResponse(body, 400) }
  }
}
