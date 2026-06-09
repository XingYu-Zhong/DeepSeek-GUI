import i18n from '../i18n'

type RuntimeErrorPayload = {
  error?: string
  message?: string
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
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim().toLowerCase()
  }
  return null
}

export function formatRuntimeError(error: unknown): string {
  const raw = stripIpcPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const payload = readJsonPayload(raw)
  const errorCode = payload?.error?.trim().toLowerCase()
  const payloadMessage = payload?.message?.trim()
  const text = stripIpcPrefix(payloadMessage || raw)
  const lowered = text.toLowerCase()

  if (errorCode === 'fetch_failed' || lowered.includes('fetch failed')) {
    return i18n.t('common:runtimeFetchFailed')
  }

  if (errorCode === 'missing_api_key') {
    return i18n.t('common:runtimeMissingApiKey')
  }

  if (errorCode === 'runtime_offline') {
    return i18n.t('common:runtimeAutoStartDisabled')
  }

  if (errorCode === 'runtime_auth_required') {
    return i18n.t('common:runtimeAuthRequired')
  }

  if (errorCode === 'runtime_request_user_input_unsupported') {
    return i18n.t('common:runtimeUserInputUnsupported')
  }

  if (errorCode === 'runtime_port_conflict') {
    return i18n.t('common:runtimePortConflict')
  }

  if (lowered.includes('runtime unhealthy')) {
    return i18n.t('common:runtimeUnhealthy')
  }

  if (errorCode === 'runtime_unhealthy') {
    return i18n.t('common:runtimeUnhealthy')
  }

  if (lowered.includes('active turn')) {
    return i18n.t('common:runtimeActiveTurn')
  }

  if (
    lowered.includes('managed runtime npm package missing') ||
    lowered.includes('kun npm package missing') ||
    lowered.includes('cannot find package.json')
  ) {
    return i18n.t('common:runtimeBinaryNotInstalled')
  }

  if (lowered.includes('preload bridge missing')) {
    return i18n.t('common:preloadBridgeMissing')
  }

  if (payloadMessage) {
    return payloadMessage
  }

  if (!text) {
    return i18n.t('common:runtimeRequestFailed')
  }

  return text
}
