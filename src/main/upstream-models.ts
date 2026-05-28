import {
  DEFAULT_DEEPSEEK_BASE_URL,
  getActiveAgentRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { DEFAULT_COMPOSER_MODEL_IDS } from '../shared/default-composer-models'
import { upstreamOpenAiModelsUrl } from '../shared/openai-compat-url'

export type FetchUpstreamModelsResult =
  | { ok: true; modelIds: string[] }
  | { ok: false; message: string }

const UPSTREAM_MODELS_TIMEOUT_MS = 8_000

export function fallbackModelIds(): string[] {
  return [...DEFAULT_COMPOSER_MODEL_IDS]
}

export async function fetchUpstreamModelIds(
  settings: AppSettingsV1,
  apiKey: string
): Promise<FetchUpstreamModelsResult> {
  const key = apiKey.trim()
  if (!key) {
    return { ok: false, message: 'Missing API key; cannot query upstream /v1/models.' }
  }
  const url = upstreamOpenAiModelsUrl(
    getActiveAgentRuntimeSettings(settings).baseUrl || DEFAULT_DEEPSEEK_BASE_URL
  )
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`
      },
      signal: AbortSignal.timeout(UPSTREAM_MODELS_TIMEOUT_MS)
    })
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        message: `Upstream models request failed (${res.status}): ${text.slice(0, 400)}`
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      return { ok: false, message: 'Upstream /v1/models returned non-JSON body.' }
    }
    const data = (parsed as { data?: unknown }).data
    if (!Array.isArray(data)) {
      return { ok: false, message: 'Upstream /v1/models JSON missing data[] array.' }
    }
    const ids = new Set<string>()
    for (const row of data) {
      if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') {
        const id = (row as { id: string }).id.trim()
        if (id) ids.add(id)
      }
    }
    const sorted = [...ids].sort((a, b) => a.localeCompare(b))
    if (sorted.length === 0) {
      return { ok: false, message: 'Upstream returned an empty model list.' }
    }
    return { ok: true, modelIds: sorted }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}
