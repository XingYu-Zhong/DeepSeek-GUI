import i18n from '../i18n'
import { redactSecrets, redactSecretText } from '@shared/secret-redaction'

type RuntimeErrorPayload = {
  code?: string
  error?: string | { message?: string; status?: number }
  message?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}

export type RuntimeErrorView = {
  summary: string
  detail?: string
  code?: string
  settingsAction?: 'agents'
}

function readJsonPayload(raw: string): RuntimeErrorPayload | null {
  try {
    return JSON.parse(raw) as RuntimeErrorPayload
  } catch {
    return null
  }
}

function stripIpcPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function getRuntimeErrorCode(error: unknown): string | null {
  const raw = stripIpcPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const payload = readJsonPayload(raw)
  return runtimeErrorCode(payload, raw)
}

function runtimeErrorCode(payload: RuntimeErrorPayload | null, raw: string): string | null {
  const fromCode = typeof payload?.code === 'string' ? payload.code.trim() : ''
  if (fromCode) return fromCode.toLowerCase()
  const fromError = typeof payload?.error === 'string' ? payload.error.trim() : ''
  if (fromError) return fromError.toLowerCase()
  const lowered = stripIpcPrefix(payloadMessage(payload) || raw).toLowerCase()
  if (lowered.includes('fetch failed')) return 'fetch_failed'
  if (lowered.includes('runtime unhealthy')) return 'runtime_unhealthy'
  if (lowered.includes('active turn')) return 'turn_in_progress'
  if (lowered.includes('preload bridge missing')) return 'preload_bridge_missing'
  if (
    lowered.includes('managed runtime npm package missing') ||
    lowered.includes('kun npm package missing') ||
    lowered.includes('cannot find package.json')
  ) {
    return 'runtime_binary_not_installed'
  }
  return null
}

function payloadMessage(payload: RuntimeErrorPayload | null): string {
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim()
  if (payload?.error && typeof payload.error === 'object') {
    const message = payload.error.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return ''
}

function detailString(value: unknown): string {
  if (value === undefined) return ''
  const redacted = redactSecrets(value)
  if (typeof redacted === 'string') return redactSecretText(redacted)
  try {
    return JSON.stringify(redacted, null, 2)
  } catch {
    return String(redacted)
  }
}

function localizedRuntimeSummary(code: string | null, text: string): string | null {
  const lowered = text.toLowerCase()

  if (code === 'fetch_failed' || lowered.includes('fetch failed')) {
    return i18n.t('common:runtimeFetchFailed')
  }

  if (code === 'missing_api_key') {
    return i18n.t('common:runtimeMissingApiKey')
  }

  if (code === 'runtime_offline') {
    return i18n.t('common:runtimeAutoStartDisabled')
  }

  if (code === 'runtime_auth_required') {
    return i18n.t('common:runtimeAuthRequired')
  }

  if (code === 'runtime_request_user_input_unsupported') {
    return i18n.t('common:runtimeUserInputUnsupported')
  }

  if (code === 'runtime_port_conflict') {
    return i18n.t('common:runtimePortConflict')
  }

  if (code === 'runtime_unhealthy' || lowered.includes('runtime unhealthy')) {
    return i18n.t('common:runtimeUnhealthy')
  }

  if (code === 'turn_in_progress' || lowered.includes('active turn')) {
    return i18n.t('common:runtimeActiveTurn')
  }

  if (code === 'runtime_binary_not_installed') {
    return i18n.t('common:runtimeBinaryNotInstalled')
  }

  if (code === 'preload_bridge_missing' || lowered.includes('preload bridge missing')) {
    return i18n.t('common:preloadBridgeMissing')
  }

  return null
}

function shouldOpenAgentsSettings(code: string | null): boolean {
  return code === 'missing_api_key' ||
    code === 'runtime_offline' ||
    code === 'runtime_auth_required' ||
    code === 'runtime_port_conflict'
}

export function describeRuntimeError(error: unknown): RuntimeErrorView {
  const raw = stripIpcPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const payload = readJsonPayload(raw)
  const errorCode = runtimeErrorCode(payload, raw)
  const payloadText = payloadMessage(payload)
  const text = stripIpcPrefix(payloadText || raw)
  const redactedText = redactSecretText(text)
  const summary = localizedRuntimeSummary(errorCode, redactedText) ||
    redactedText ||
    i18n.t('common:runtimeRequestFailed')
  const details: string[] = []
  if (errorCode) details.push(`Code: ${errorCode}`)
  if (payload?.severity) details.push(`Severity: ${payload.severity}`)
  if (
    redactedText &&
    (redactedText !== summary || Boolean(errorCode) || Boolean(payload?.severity) || payload?.details !== undefined)
  ) {
    details.push(`Message:\n${redactedText}`)
  }
  const payloadDetails = detailString(payload?.details)
  if (payloadDetails) details.push(`Details:\n${payloadDetails}`)
  if (!payload && raw && raw !== redactedText) {
    details.push(`Raw:\n${redactSecretText(raw)}`)
  }
  return {
    summary,
    ...(details.length > 0 ? { detail: details.join('\n\n') } : {}),
    ...(errorCode ? { code: errorCode } : {}),
    ...(shouldOpenAgentsSettings(errorCode) ? { settingsAction: 'agents' as const } : {})
  }
}

export function formatRuntimeError(error: unknown): string {
  return describeRuntimeError(error).summary
}
