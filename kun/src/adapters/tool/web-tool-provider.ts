import type { KunCapabilitiesConfig, WebCapabilityConfig } from '../../contracts/capabilities.js'
import type { WebFetchResult, WebProvider, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor, UnavailableWebProvider } from '../../ports/web-provider.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const DEFAULT_WEB_TIMEOUT_MS = 15_000
const DEFAULT_WEB_MAX_BYTES = 1_000_000
const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_LIMIT = 10

export type WebProviderDiagnostic = {
  id: string
  enabled: boolean
  available: boolean
  fetchAvailable: boolean
  searchAvailable: boolean
  provider?: string
  reason?: string
}

export type WebToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: WebProviderDiagnostic[]
  fetchAvailable: boolean
  searchAvailable: boolean
  provider?: string
}

export type WebToolProviderOptions = {
  provider?: WebProvider
  nowIso?: () => string
}

export function buildWebToolProviders(
  config: KunCapabilitiesConfig['web'] | undefined,
  options: WebToolProviderOptions = {}
): WebToolProviderBuildResult {
  const web = config
  if (!web?.enabled) {
    return {
      providers: [],
      diagnostics: [],
      fetchAvailable: false,
      searchAvailable: false
    }
  }

  const provider: WebProvider = options.provider ?? (web.fetchEnabled ? new FetchWebProvider(options.nowIso) : new UnavailableWebProvider(web.provider))
  const tools = []
  if (web.fetchEnabled) {
    tools.push(createFetchTool(web, provider))
  }
  if (web.searchEnabled) {
    tools.push(createSearchTool(web, provider))
  }
  const fetchAvailable = Boolean(web.fetchEnabled && provider.fetch)
  const searchAvailable = Boolean(web.searchEnabled && provider.search)
  const reason = !tools.length
    ? 'web tools are disabled by config'
    : !fetchAvailable && !searchAvailable
      ? 'web provider is unavailable'
      : undefined

  return {
    providers: tools.length
      ? [{
          id: 'web',
          kind: 'web',
          enabled: true,
          available: true,
          ...(reason ? { reason } : {}),
          tools
        }]
      : [],
    diagnostics: [{
      id: 'web',
      enabled: true,
      available: fetchAvailable || searchAvailable,
      fetchAvailable,
      searchAvailable,
      provider: provider.id,
      ...(reason ? { reason } : {})
    }],
    fetchAvailable,
    searchAvailable,
    provider: provider.id
  }
}

function createFetchTool(config: WebCapabilityConfig, provider: WebProvider) {
  return LocalToolHost.defineTool({
    name: 'web_fetch',
    description: 'Fetch an allowed HTTP or HTTPS URL and return extracted text with source metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_bytes: { type: 'number' },
        timeout_ms: { type: 'number' }
      },
      required: ['url'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const rawUrl = pickString(args.url)
      if (!rawUrl) return toolError('invalid_url', 'url is required')
      const policy = validateUrlPolicy(rawUrl, config)
      if (!policy.ok) return toolError('policy_blocked', policy.reason, telemetry({ startedAt, policy: 'blocked', url: rawUrl }))
      if (!provider.fetch) return toolError('provider_unavailable', 'web fetch provider is unavailable')
      const maxBytes = boundedInt(args.max_bytes, DEFAULT_WEB_MAX_BYTES, 1, DEFAULT_WEB_MAX_BYTES)
      const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_WEB_TIMEOUT_MS, 1, DEFAULT_WEB_TIMEOUT_MS)
      try {
        const result = await provider.fetch({
          url: policy.url.href,
          maxBytes,
          timeoutMs,
          signal: context.abortSignal
        })
        return {
          output: fetchOutput(result, telemetry({
            startedAt,
            policy: 'allowed',
            url: policy.url.href,
            provider: provider.id,
            byteCount: result.byteCount
          }))
        }
      } catch (error) {
        return toolError('fetch_failed', errorMessage(error), telemetry({
          startedAt,
          policy: 'allowed',
          url: policy.url.href,
          provider: provider.id
        }))
      }
    }
  })
}

function createSearchTool(config: WebCapabilityConfig, provider: WebProvider) {
  return LocalToolHost.defineTool({
    name: 'web_search',
    description: 'Search the web through the configured provider and return ranked results with source metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
        timeout_ms: { type: 'number' }
      },
      required: ['query'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const query = pickString(args.query)
      if (!query) return toolError('invalid_query', 'query is required')
      if (!provider.search) return toolError('provider_unavailable', 'web search provider is unavailable')
      const limit = boundedInt(args.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT)
      const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_WEB_TIMEOUT_MS, 1, DEFAULT_WEB_TIMEOUT_MS)
      try {
        const results = await provider.search({
          query,
          limit,
          timeoutMs,
          signal: context.abortSignal
        })
        return {
          output: searchOutput(query, provider.id, results, telemetry({
            startedAt,
            policy: 'allowed',
            provider: provider.id,
            query,
            resultCount: results.length
          }))
        }
      } catch (error) {
        return toolError('search_failed', errorMessage(error), telemetry({
          startedAt,
          policy: 'allowed',
          provider: provider.id,
          query
        }))
      }
    }
  })
}

class FetchWebProvider implements WebProvider {
  readonly id = 'fetch'
  private readonly nowIso: () => string

  constructor(nowIso: (() => string) | undefined) {
    this.nowIso = nowIso ?? (() => new Date().toISOString())
  }

  async fetch(request: {
    url: string
    maxBytes: number
    timeoutMs: number
    signal: AbortSignal
  }): Promise<WebFetchResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(request.url, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const truncated = buffer.length > request.maxBytes
      const readableBuffer = truncated ? buffer.subarray(0, request.maxBytes) : buffer
      const contentType = response.headers.get('content-type') ?? undefined
      const raw = readableBuffer.toString('utf8')
      const extracted = extractReadableText(raw, contentType)
      const finalUrl = response.url || request.url
      return {
        sourceId: sourceIdFor('fetch', finalUrl),
        url: request.url,
        finalUrl,
        title: extracted.title,
        contentType,
        text: extracted.text,
        retrievedAt: this.nowIso(),
        byteCount: buffer.length,
        truncated
      }
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
    }
  }
}

function fetchOutput(result: WebFetchResult, toolTelemetry: Record<string, unknown>) {
  const source = {
    sourceId: result.sourceId,
    url: result.finalUrl,
    title: result.title,
    retrievedAt: result.retrievedAt
  }
  return {
    sourceId: result.sourceId,
    url: result.url,
    finalUrl: result.finalUrl,
    title: result.title,
    retrievedAt: result.retrievedAt,
    contentType: result.contentType,
    text: result.text,
    byteCount: result.byteCount,
    truncated: result.truncated,
    sources: [source],
    citations: [source],
    telemetry: toolTelemetry
  }
}

function searchOutput(
  query: string,
  provider: string,
  results: WebSearchResult[],
  toolTelemetry: Record<string, unknown>
) {
  const sources = results.map((result) => ({
    sourceId: result.sourceId,
    url: result.url,
    title: result.title,
    retrievedAt: result.retrievedAt
  }))
  return {
    query,
    provider,
    results,
    sources,
    citations: sources,
    telemetry: toolTelemetry
  }
}

function validateUrlPolicy(rawUrl: string, config: WebCapabilityConfig): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'URL must be absolute' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https URLs are allowed' }
  }
  const hostname = url.hostname.toLowerCase()
  if (config.denyDomains.some((domain) => domainMatches(hostname, domain))) {
    return { ok: false, reason: `domain is denied: ${hostname}` }
  }
  if (config.allowDomains.length > 0 && !config.allowDomains.some((domain) => domainMatches(hostname, domain))) {
    return { ok: false, reason: `domain is not allowed: ${hostname}` }
  }
  return { ok: true, url }
}

function domainMatches(hostname: string, domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^\./, '')
  return hostname === normalized || hostname.endsWith(`.${normalized}`)
}

function extractReadableText(raw: string, contentType: string | undefined): { title?: string; text: string } {
  if (!contentType?.toLowerCase().includes('html')) {
    return { text: normalizeWhitespace(raw) }
  }
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const withoutScripts = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return {
    ...(title ? { title: normalizeWhitespace(decodeHtmlEntities(title)) } : {}),
    text: normalizeWhitespace(decodeHtmlEntities(text))
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function telemetry(input: {
  startedAt: number
  policy: 'allowed' | 'blocked'
  provider?: string
  url?: string
  query?: string
  byteCount?: number
  resultCount?: number
}): Record<string, unknown> {
  return {
    provider: input.provider,
    url: input.url,
    query: input.query,
    byteCount: input.byteCount,
    resultCount: input.resultCount,
    durationMs: Date.now() - input.startedAt,
    cacheStatus: 'miss',
    policy: input.policy
  }
}

function toolError(code: string, message: string, toolTelemetry?: Record<string, unknown>) {
  return {
    output: {
      error: {
        code,
        message
      },
      ...(toolTelemetry ? { telemetry: toolTelemetry } : {})
    },
    isError: true
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
