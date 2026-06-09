import { jsonResponse, type JsonResponse } from '../response.js'

/** Build the `GET /health` response. The endpoint is unauthenticated. */
export function healthJsonResponse(): JsonResponse {
  return jsonResponse({ status: 'ok', service: 'kun', mode: 'serve' })
}
