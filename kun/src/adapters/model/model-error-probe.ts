export type DeepSeekProbeResult = {
  reachable: boolean
  status?: number
  message: string
}

export function isDeepSeekHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.deepseek.com' || host.endsWith('.deepseek.com')
  } catch {
    return false
  }
}

export async function probeDeepSeekReachable(input: {
  baseUrl: string
  fetchImpl: typeof fetch
}): Promise<DeepSeekProbeResult> {
  const url = probeUrl(input.baseUrl)
  try {
    const response = await input.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' }
    })
    return {
      reachable: response.status < 500,
      status: response.status,
      message: response.status < 500
        ? `DeepSeek endpoint is reachable (probe status ${response.status}).`
        : `DeepSeek endpoint probe also returned ${response.status}.`
    }
  } catch (error) {
    return {
      reachable: false,
      message: `DeepSeek endpoint probe failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function probeUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://api.deepseek.com/v1/models'
  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1)?.toLowerCase() === 'beta' || /^v\d+$/i.test(parts.at(-1) ?? '')) {
      parts.pop()
    }
    url.pathname = `/${[...parts, 'v1', 'models'].join('/')}`
    url.search = ''
    return url.toString()
  } catch {
    return 'https://api.deepseek.com/v1/models'
  }
}
