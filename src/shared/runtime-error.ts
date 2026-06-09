/**
 * Shared parser for Kun runtime error bodies.
 *
 * Kun's contract (`kun/src/contracts/errors.ts`) returns
 * `{ code, message, details? }`. Older code paths may also surface
 * `{ error: string | { message }, message? }` where `error` is a
 * legacy machine-readable code (e.g. `runtime_auth_required`).
 *
 * This module normalises both shapes so the renderer and main
 * process agree on a single `RuntimeError` view. The `code` field
 * always carries either a Kun contract code or one of the
 * `LEGACY_MAIN_GUARD_CODES` (main-process guard codes that aren't
 * part of the Kun schema). `details` carries the original
 * payload untouched so callers that need more context can read it.
 */
export type KunErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'turn_in_progress'
  | 'turn_not_running'
  | 'approval_not_pending'
  | 'internal_error'
  | 'not_implemented'
  | 'aborted'
  | 'unknown'

export type LegacyMainGuardCode =
  | 'runtime_auth_required'
  | 'runtime_request_failed'
  | 'fetch_failed'
  | 'runtime_offline'
  | 'runtime_port_conflict'
  | 'runtime_unhealthy'
  | 'missing_api_key'

export type RuntimeErrorCode = KunErrorCode | LegacyMainGuardCode

export type RuntimeError = {
  code: RuntimeErrorCode
  message: string
  details?: unknown
}

const KNOWN_KUN_CODES: ReadonlySet<KunErrorCode> = new Set<KunErrorCode>([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'turn_in_progress',
  'turn_not_running',
  'approval_not_pending',
  'internal_error',
  'not_implemented',
  'aborted'
])

const KNOWN_LEGACY_CODES: ReadonlySet<LegacyMainGuardCode> = new Set<LegacyMainGuardCode>([
  'runtime_auth_required',
  'runtime_request_failed',
  'fetch_failed',
  'runtime_offline',
  'runtime_port_conflict',
  'runtime_unhealthy',
  'missing_api_key'
])

function normalizeCode(value: unknown): RuntimeErrorCode {
  if (typeof value !== 'string') return 'unknown'
  if ((KNOWN_KUN_CODES as Set<string>).has(value)) return value as KunErrorCode
  if ((KNOWN_LEGACY_CODES as Set<string>).has(value)) return value as LegacyMainGuardCode
  return 'unknown'
}

function readString(...candidates: Array<unknown>): string {
  for (const value of candidates) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return ''
}

function readNestedMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return readString(record.message)
}

/**
 * Parse a Kun runtime error body. Falls back to the supplied
 * fallback message when the body is empty, not JSON, or carries no
 * recognisable fields. The returned object always has `code` and
 * `message`; `details` is only present when the body carried one.
 */
export function parseRuntimeErrorBody(body: string, fallback: string): RuntimeError {
  if (!body) {
    return { code: 'unknown', message: fallback }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    const trimmed = body.trim()
    return { code: 'unknown', message: trimmed || fallback }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { code: 'unknown', message: fallback }
  }
  const record = parsed as Record<string, unknown>
  const code = normalizeCode(record.code ?? record.error)
  const nestedMessage = readNestedMessage(record.error)
  const topErrorMessage = typeof record.error === 'string' ? record.error.trim() : ''
  const message =
    readString(record.message) || topErrorMessage || nestedMessage || fallback
  const details = 'details' in record ? record.details : undefined
  return details === undefined ? { code, message } : { code, message, details }
}

/**
 * Convert a parsed runtime error into a JS `Error` instance. The
 * `message` carries the human-readable string; the `code` and any
 * `details` are embedded as a JSON envelope so consumers that need
 * structured access can still parse it back out via
 * `parseRuntimeErrorBody`.
 */
export function runtimeErrorToError(error: RuntimeError): Error {
  if (error.code === 'unknown' && error.details === undefined) {
    return new Error(error.message)
  }
  return new Error(
    JSON.stringify({ code: error.code, message: error.message, details: error.details })
  )
}

export function isKnownKunErrorCode(value: unknown): value is KunErrorCode {
  return typeof value === 'string' && (KNOWN_KUN_CODES as Set<string>).has(value)
}

export function isLegacyMainGuardCode(value: unknown): value is LegacyMainGuardCode {
  return typeof value === 'string' && (KNOWN_LEGACY_CODES as Set<string>).has(value)
}
