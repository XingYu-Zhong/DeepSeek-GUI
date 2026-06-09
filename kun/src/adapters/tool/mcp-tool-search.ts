import type {
  McpSearchConfig,
  McpServerConfig
} from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

const MCP_SEARCH_TOOL_NAME = 'mcp_search'
const MCP_DESCRIBE_TOOL_NAME = 'mcp_describe'
const MCP_CALL_TOOL_NAME = 'mcp_call'
const MCP_REFRESH_CATALOG_TOOL_NAME = 'mcp_refresh_catalog'

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'about',
  'there',
  'their',
  'will',
  'would',
  'could',
  'should',
  'have',
  'has',
  'are',
  'was',
  'were',
  'been',
  'not',
  'but',
  'you',
  'your',
  'our',
  'can',
  'then',
  'when',
  'what',
  'how'
])

const ACTION_SYNONYMS: Record<string, string[]> = {
  search: ['find', 'lookup', 'query', '查', '搜索', '检索', '找'],
  find: ['search', 'lookup', 'query', '查找'],
  list: ['show', 'enumerate', '列出', '列表'],
  get: ['read', 'fetch', 'retrieve', 'describe', '获取', '读取', '查看'],
  create: ['add', 'new', 'make', '创建', '新增'],
  update: ['edit', 'modify', 'set', 'change', '更新', '修改'],
  delete: ['remove', 'destroy', '删除', '移除'],
  send: ['post', 'publish', 'reply', 'comment', '发送', '回复', '评论']
}

export type McpSearchClientLike = {
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
}

export type McpSearchToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execution?: unknown
  icons?: unknown
  _meta?: Record<string, unknown>
}

export type McpSearchCatalogRecord = {
  toolId: string
  serverId: string
  server: McpServerConfig
  client: McpSearchClientLike
  descriptor: McpSearchToolDescriptor
  normalizedName: string
  policy: LocalTool['policy']
}

export type McpSearchRuntimeDiagnostic = {
  enabled: boolean
  mode: McpSearchConfig['mode']
  active: boolean
  indexedToolCount: number
  advertisedToolCount: number
  topKDefault: number
  topKMax: number
  minScore: number
  lastRefreshedAt?: string
  lastError?: string
  catalogFingerprint?: string
  catalogDrift?: boolean
}

export type McpSearchCatalogState = {
  records: McpSearchCatalogRecord[]
  lastRefreshedAt?: string
  lastError?: string
  catalogFingerprint?: string
  catalogDrift?: boolean
}

export type McpSearchProviderOptions = {
  config: McpSearchConfig
  state: McpSearchCatalogState
  refreshCatalog: () => Promise<McpSearchCatalogRecord[]>
  isServerTrusted: (server: McpServerConfig, workspace: string) => boolean
}

type IndexedTool = {
  record: McpSearchCatalogRecord
  tokens: string[]
  termFrequency: Map<string, number>
  exactTokens: Set<string>
  actionTokens: Set<string>
  paramTokens: Set<string>
}

type McpSearchIndex = {
  tools: IndexedTool[]
  documentFrequency: Map<string, number>
  averageLength: number
}

type QueryModel = {
  text: string
  terms: string[]
  weights: Map<string, number>
}

type SearchResult = {
  record: McpSearchCatalogRecord
  score: number
  keywords: string[]
}

export function createMcpSearchProvider(
  options: McpSearchProviderOptions
): CapabilityToolProvider {
  return {
    id: 'mcp:search',
    kind: 'mcp',
    enabled: true,
    available: true,
    tools: createMcpSearchTools(options)
  }
}

export function mcpSearchDiagnostic(input: {
  config: McpSearchConfig
  active: boolean
  indexedToolCount: number
  advertisedToolCount: number
  state: McpSearchCatalogState
}): McpSearchRuntimeDiagnostic {
  return {
    enabled: input.config.enabled,
    mode: input.config.mode,
    active: input.active,
    indexedToolCount: input.indexedToolCount,
    advertisedToolCount: input.advertisedToolCount,
    topKDefault: input.config.topKDefault,
    topKMax: input.config.topKMax,
    minScore: input.config.minScore,
    ...(input.state.lastRefreshedAt ? { lastRefreshedAt: input.state.lastRefreshedAt } : {}),
    ...(input.state.lastError ? { lastError: input.state.lastError } : {}),
    ...(input.state.catalogFingerprint ? { catalogFingerprint: input.state.catalogFingerprint } : {}),
    ...(input.state.catalogDrift !== undefined ? { catalogDrift: input.state.catalogDrift } : {})
  }
}

export function tokenizeMcpSearchText(text = ''): string[] {
  const source = normalizeLower(text)
  const tokens: string[] = []

  const latinTerms = source.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (const term of latinTerms) {
    for (const part of term.split(/[_-]+/)) {
      if (tokenAllowed(part)) tokens.push(part)
    }
    if (tokenAllowed(term)) tokens.push(term)
  }

  const hanSegments = source.match(/\p{Script=Han}+/gu) ?? []
  for (const segment of hanSegments) {
    const chars = [...segment].slice(0, 80)
    if (chars.length === 1) {
      tokens.push(chars[0])
      continue
    }
    for (let size = 2; size <= Math.min(4, chars.length); size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) {
        tokens.push(chars.slice(index, index + size).join(''))
      }
    }
  }

  return tokens
}

function createMcpSearchTools(options: McpSearchProviderOptions): LocalTool[] {
  return [
    LocalToolHost.defineTool({
      name: MCP_SEARCH_TOOL_NAME,
      description: 'Search connected MCP tools by natural-language intent, server, action, and parameter names.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The user intent or task to find MCP tools for.' },
          topK: { type: 'number', description: 'Maximum number of matching tools to return.' },
          serverId: { type: 'string', description: 'Optional MCP server id to search within.' }
        },
        required: ['query']
      },
      policy: 'auto',
      execute: async (args, context) => {
        const query = stringArg(args.query)
        if (!query) return { output: { error: 'query is required' }, isError: true }
        const serverId = stringArg(args.serverId)
        const topK = clampPositiveInt(numberArg(args.topK), options.config.topKDefault, options.config.topKMax)
        const records = trustedRecords(options, context)
          .filter((record) => !serverId || record.serverId === serverId)
        const results = searchRecords(records, query, topK, options.config)
        return {
          output: {
            query,
            totalIndexed: options.state.records.length,
            searchedTools: records.length,
            results: results.map(formatSearchResult)
          }
        }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_DESCRIBE_TOOL_NAME,
      description: 'Return the full schema and metadata for a connected MCP tool found by mcp_search.',
      inputSchema: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Canonical MCP tool id in the form serverId/toolName.' }
        },
        required: ['toolId']
      },
      policy: 'auto',
      execute: async (args, context) => {
        const toolId = stringArg(args.toolId)
        const record = resolveTrustedRecord(options, context, toolId)
        if (!record) return { output: { error: `unknown MCP tool: ${toolId}` }, isError: true }
        return { output: describeRecord(record) }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_CALL_TOOL_NAME,
      description: 'Call a connected MCP tool by canonical tool id with JSON arguments.',
      inputSchema: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Canonical MCP tool id in the form serverId/toolName.' },
          arguments: { type: 'object', description: 'Arguments matching the MCP tool input schema.' }
        },
        required: ['toolId', 'arguments']
      },
      policy: 'on-request',
      execute: async (args, context) => {
        const toolId = stringArg(args.toolId)
        const record = resolveTrustedRecord(options, context, toolId)
        if (!record) return { output: { error: `unknown MCP tool: ${toolId}` }, isError: true }
        const callArgs = objectArg(args.arguments)
        const result = await record.client.callTool(
          { name: record.descriptor.name, arguments: callArgs },
          { signal: context.abortSignal, timeout: record.server.timeoutMs }
        )
        return {
          output: {
            serverId: record.serverId,
            toolName: record.descriptor.name,
            toolId: record.toolId,
            result
          },
          isError: typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
        }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_REFRESH_CATALOG_TOOL_NAME,
      description: 'Refresh the MCP tool catalog and rebuild the local search index.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      policy: 'auto',
      execute: async () => {
        const records = await options.refreshCatalog()
        return {
          output: {
            refreshedAt: options.state.lastRefreshedAt,
            totalIndexed: records.length,
            catalogFingerprint: options.state.catalogFingerprint,
            catalogDrift: options.state.catalogDrift === true
          }
        }
      }
    })
  ]
}

function trustedRecords(options: McpSearchProviderOptions, context: ToolHostContext): McpSearchCatalogRecord[] {
  return options.state.records.filter((record) => options.isServerTrusted(record.server, context.workspace))
}

function resolveTrustedRecord(
  options: McpSearchProviderOptions,
  context: ToolHostContext,
  toolId: string
): McpSearchCatalogRecord | undefined {
  if (!toolId) return undefined
  return trustedRecords(options, context).find((record) => record.toolId === toolId)
}

function searchRecords(
  records: McpSearchCatalogRecord[],
  queryText: string,
  topK: number,
  config: McpSearchConfig
): SearchResult[] {
  const query = buildQuery(queryText)
  if (query.terms.length === 0) return []
  const index = buildIndex(records)
  return index.tools
    .map((tool) => {
      const keyword = keywordScore(tool, query)
      return {
        record: tool.record,
        score: bm25Score(tool, index, query, config) + keyword.score,
        keywords: keyword.keywords
      }
    })
    .filter((result) => result.score >= config.minScore && result.keywords.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

function buildIndex(records: McpSearchCatalogRecord[]): McpSearchIndex {
  const tools = records.map(indexRecord)
  const documentFrequency = new Map<string, number>()
  let tokenCount = 0
  for (const tool of tools) {
    tokenCount += tool.tokens.length
    for (const token of new Set(tool.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }
  return {
    tools,
    documentFrequency,
    averageLength: tools.length > 0 ? tokenCount / tools.length : 1
  }
}

function indexRecord(record: McpSearchCatalogRecord): IndexedTool {
  const descriptor = record.descriptor
  const inputSchema = descriptor.inputSchema ?? { type: 'object' }
  const paramText = extractSchemaText(inputSchema)
  const exact = [
    record.serverId,
    descriptor.name,
    descriptor.title,
    descriptor.annotations?.title,
    record.normalizedName,
    record.toolId
  ].filter(Boolean).join(' ')
  const action = actionWords(descriptor.name)
  const semantic = [descriptor.description, descriptor.title, descriptor.annotations?.title].filter(Boolean).join(' ')
  const risk = [
    descriptor.annotations?.readOnlyHint ? 'read read-only readonly safe' : '',
    descriptor.annotations?.destructiveHint ? 'delete destructive dangerous high-risk' : '',
    descriptor.annotations?.openWorldHint ? 'external network open-world' : ''
  ].join(' ')
  const server = [record.serverId, record.server.transport, record.server.trustScope].join(' ')
  const exactTokens = new Set(tokenizeMcpSearchText(exact))
  const actionTokens = new Set(tokenizeMcpSearchText(action))
  const paramTokens = new Set(tokenizeMcpSearchText(paramText))
  const tokens = [
    ...repeatTokens(exactTokens, 5),
    ...repeatTokens(actionTokens, 3),
    ...repeatTokens(paramTokens, 2),
    ...tokenizeMcpSearchText(semantic),
    ...tokenizeMcpSearchText(server),
    ...tokenizeMcpSearchText(risk)
  ]
  return {
    record,
    tokens,
    termFrequency: termFrequency(tokens),
    exactTokens,
    actionTokens,
    paramTokens
  }
}

function buildQuery(text: string): QueryModel {
  const weights = new Map<string, number>()
  for (const token of expandQueryTokens(tokenizeMcpSearchText(text))) {
    weights.set(token, (weights.get(token) ?? 0) + 1)
  }
  return {
    text,
    terms: [...weights.keys()].slice(0, 48),
    weights
  }
}

function expandQueryTokens(tokens: string[]): string[] {
  const out = [...tokens]
  for (const token of tokens) {
    const synonyms = ACTION_SYNONYMS[token]
    if (synonyms) out.push(...synonyms)
    for (const [action, values] of Object.entries(ACTION_SYNONYMS)) {
      if (values.includes(token)) out.push(action)
    }
  }
  return out
}

function bm25Score(
  tool: IndexedTool,
  index: McpSearchIndex,
  query: QueryModel,
  config: McpSearchConfig
): number {
  const totalDocs = Math.max(index.tools.length, 1)
  const averageLength = Math.max(index.averageLength, 1)
  const k1 = config.bm25.k1
  const b = config.bm25.b
  let score = 0
  for (const term of query.terms) {
    const tf = tool.termFrequency.get(term) ?? 0
    if (!tf) continue
    const df = index.documentFrequency.get(term) ?? 0
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))
    const normalized = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tool.tokens.length / averageLength)))
    const weight = query.weights.get(term) ?? 1
    score += weight * idf * normalized
  }
  return score
}

function keywordScore(tool: IndexedTool, query: QueryModel): { score: number; keywords: string[] } {
  let score = 0
  const keywords: string[] = []
  for (const term of query.terms) {
    if (!tool.termFrequency.has(term)) continue
    keywords.push(term)
    const weight = query.weights.get(term) ?? 1
    if (tool.exactTokens.has(term)) score += 0.8 * weight
    if (tool.actionTokens.has(term)) score += 0.45 * weight
    if (tool.paramTokens.has(term)) score += 0.35 * weight
  }
  if (keywords.length > 0) score += Math.sqrt(keywords.length) * 0.2
  return { score, keywords: keywords.slice(0, 10) }
}

function formatSearchResult(result: SearchResult): Record<string, unknown> {
  const descriptor = result.record.descriptor
  return {
    toolId: result.record.toolId,
    serverId: result.record.serverId,
    toolName: descriptor.name,
    title: descriptor.title ?? descriptor.annotations?.title,
    description: descriptor.description ?? '',
    score: Number(result.score.toFixed(3)),
    matchedKeywords: result.keywords,
    inputSummary: summarizeSchema(descriptor.inputSchema),
    policy: result.record.policy,
    risk: {
      readOnly: descriptor.annotations?.readOnlyHint === true,
      destructive: descriptor.annotations?.destructiveHint === true,
      openWorld: descriptor.annotations?.openWorldHint === true
    }
  }
}

function describeRecord(record: McpSearchCatalogRecord): Record<string, unknown> {
  const descriptor = record.descriptor
  return {
    toolId: record.toolId,
    serverId: record.serverId,
    toolName: descriptor.name,
    normalizedName: record.normalizedName,
    title: descriptor.title ?? descriptor.annotations?.title,
    description: descriptor.description ?? '',
    inputSchema: descriptor.inputSchema ?? { type: 'object' },
    ...(descriptor.outputSchema ? { outputSchema: descriptor.outputSchema } : {}),
    ...(descriptor.annotations ? { annotations: descriptor.annotations } : {}),
    ...(descriptor.execution ? { execution: descriptor.execution } : {}),
    ...(descriptor.icons ? { icons: descriptor.icons } : {}),
    ...(descriptor._meta ? { meta: descriptor._meta } : {}),
    policy: record.policy
  }
}

function extractSchemaText(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return ''
  const pieces: string[] = []
  const visit = (value: unknown, keyHint = ''): void => {
    if (!value || typeof value !== 'object') return
    const obj = value as Record<string, unknown>
    if (keyHint) pieces.push(keyHint)
    if (typeof obj.title === 'string') pieces.push(obj.title)
    if (typeof obj.description === 'string') pieces.push(obj.description)
    if (Array.isArray(obj.enum)) pieces.push(obj.enum.filter((item) => typeof item === 'string').join(' '))
    const properties = obj.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        pieces.push(key)
        visit(child, key)
      }
    }
  }
  visit(schema)
  return pieces.join(' ')
}

function summarizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { required: [], parameters: [] }
  const obj = schema as { properties?: Record<string, unknown>; required?: unknown }
  const properties = obj.properties && typeof obj.properties === 'object' && !Array.isArray(obj.properties)
    ? obj.properties
    : {}
  return {
    required: Array.isArray(obj.required) ? obj.required.filter((item) => typeof item === 'string') : [],
    parameters: Object.keys(properties).slice(0, 12)
  }
}

function actionWords(name: string): string {
  const tokens = tokenizeMcpSearchText(name.replace(/[._:/-]+/g, ' '))
  const expanded = expandQueryTokens(tokens)
  return expanded.join(' ')
}

function repeatTokens(tokens: Iterable<string>, count: number): string[] {
  const out: string[] = []
  for (const token of tokens) {
    for (let i = 0; i < count; i += 1) out.push(token)
  }
  return out
}

function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1)
  }
  return map
}

function normalizeLower(text = ''): string {
  return String(text || '').normalize('NFKC').toLowerCase()
}

function tokenAllowed(token: string): boolean {
  if (!token || STOP_WORDS.has(token)) return false
  if (/^\d+$/.test(token)) return false
  return token.length >= 2
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectArg(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!value || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}
