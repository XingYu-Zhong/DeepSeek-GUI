import { jsonResponse, type JsonResponse } from '../response.js'
import type { KunErrorBody } from '../../contracts/errors.js'

export type RuntimeError = KunErrorBody

export function errorResponse(
  body: RuntimeError,
  status: number
): JsonResponse {
  return jsonResponse(body, status)
}

export const ERRORS = {
  unauthorized: (message = 'unauthorized') =>
    errorResponse({ code: 'unauthorized', message }, 401),
  forbidden: (message = 'forbidden') =>
    errorResponse({ code: 'forbidden', message }, 403),
  notFound: (message = 'not found') =>
    errorResponse({ code: 'not_found', message }, 404),
  validation: (message: string, issues?: unknown) =>
    errorResponse({ code: 'validation_error', message, details: issues }, 400),
  attachmentValidation: (message: string, issues?: unknown) =>
    errorResponse({ code: 'attachment_validation_failed', message, details: issues }, 400),
  conflict: (message: string) =>
    errorResponse({ code: 'conflict', message }, 409),
  notImplemented: (message: string) =>
    errorResponse({ code: 'not_implemented', message }, 501),
  unavailable: (message: string) =>
    errorResponse({ code: 'capability_unavailable', message }, 503),
  internal: (message: string) =>
    errorResponse({ code: 'internal_error', message }, 500)
} as const
