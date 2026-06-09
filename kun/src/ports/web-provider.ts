export type WebSource = {
  sourceId: string
  url: string
  title?: string
  retrievedAt: string
}

export type WebFetchRequest = {
  url: string
  maxBytes: number
  timeoutMs: number
  signal: AbortSignal
}

export type WebFetchResult = WebSource & {
  finalUrl: string
  contentType?: string
  text: string
  byteCount: number
  truncated: boolean
}

export type WebSearchRequest = {
  query: string
  limit: number
  timeoutMs: number
  signal: AbortSignal
}

export type WebSearchResult = WebSource & {
  snippet: string
  provider: string
  rank: number
}

export interface WebProvider {
  readonly id: string
  fetch?(request: WebFetchRequest): Promise<WebFetchResult>
  search?(request: WebSearchRequest): Promise<WebSearchResult[]>
}

export class UnavailableWebProvider implements WebProvider {
  readonly id: string

  constructor(id = 'unavailable') {
    this.id = id
  }
}

export class DeterministicWebProvider implements WebProvider {
  readonly id: string
  private readonly pages: Map<string, Omit<WebFetchResult, 'sourceId' | 'retrievedAt' | 'byteCount' | 'truncated'>>
  private readonly searchResults: Map<string, Array<Omit<WebSearchResult, 'sourceId' | 'retrievedAt' | 'provider' | 'rank'>>>
  private readonly nowIso: () => string

  constructor(input: {
    id?: string
    nowIso?: () => string
    pages?: Record<string, Omit<WebFetchResult, 'sourceId' | 'retrievedAt' | 'byteCount' | 'truncated'>>
    searchResults?: Record<string, Array<Omit<WebSearchResult, 'sourceId' | 'retrievedAt' | 'provider' | 'rank'>>>
  } = {}) {
    this.id = input.id ?? 'deterministic'
    this.nowIso = input.nowIso ?? (() => new Date().toISOString())
    this.pages = new Map(Object.entries(input.pages ?? {}))
    this.searchResults = new Map(Object.entries(input.searchResults ?? {}))
  }

  async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
    const page = this.pages.get(request.url)
    if (!page) throw new Error(`test web page not found: ${request.url}`)
    const bytes = Buffer.byteLength(page.text, 'utf8')
    if (bytes > request.maxBytes) {
      throw new Error(`content exceeds ${request.maxBytes} byte limit`)
    }
    return {
      ...page,
      url: page.url,
      finalUrl: page.finalUrl,
      sourceId: sourceIdFor('fetch', page.finalUrl),
      retrievedAt: this.nowIso(),
      byteCount: bytes,
      truncated: false
    }
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    return (this.searchResults.get(request.query) ?? [])
      .slice(0, request.limit)
      .map((result, index) => ({
        ...result,
        sourceId: sourceIdFor('search', `${request.query}:${result.url}:${index}`),
        retrievedAt: this.nowIso(),
        provider: this.id,
        rank: index + 1
      }))
  }
}

export function sourceIdFor(kind: 'fetch' | 'search', value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return `web_${kind}_${Math.abs(hash).toString(36)}`
}
