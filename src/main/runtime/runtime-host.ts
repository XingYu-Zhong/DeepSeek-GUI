import type { AgentProviderId } from '../../shared/agent-catalog'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { runtimeAuthHeaders } from './local-http-runtime-adapter'
import { getActiveRuntimeAdapter, getRuntimeAdapter } from './codewhale-adapter'

export { getActiveRuntimeAdapter, getRuntimeAdapter, codewhaleRuntimeAdapter } from './codewhale-adapter'
export { runtimeAuthHeaders } from './local-http-runtime-adapter'
export type { LocalHttpRuntimeAdapter } from './local-http-runtime-adapter'

export function getRuntimeBaseUrlForSettings(settings: AppSettingsV1): string {
  return getActiveRuntimeAdapter(settings).getBaseUrl(settings)
}

export async function runtimeRequestViaHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
  ensureRuntime: (settings: AppSettingsV1) => Promise<void>
): Promise<{ ok: boolean; status: number; body: string }> {
  await ensureRuntime(settings)
  const base = getRuntimeBaseUrlForSettings(settings)
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  const url = `${base}${pathNorm}`
  const hdrs = runtimeAuthHeaders(settings)
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    hdrs.set(key, value)
  }
  hdrs.set('Accept', 'application/json')
  if (init.body && !hdrs.has('Content-Type')) {
    hdrs.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: hdrs,
    body: init.body,
    signal: AbortSignal.timeout(init.method === 'POST' ? 60_000 : 15_000)
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

export function isKnownRuntimeProvider(providerId: unknown): providerId is AgentProviderId {
  return providerId === 'codewhale'
}
