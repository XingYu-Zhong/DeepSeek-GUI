import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createHash } from 'node:crypto'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpCapabilityConfig,
  McpServerConfig
} from '../../contracts/capabilities.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  createMcpSearchProvider,
  mcpSearchDiagnostic,
  type McpSearchCatalogRecord,
  type McpSearchCatalogState,
  type McpSearchRuntimeDiagnostic
} from './mcp-tool-search.js'

export type McpToolDescriptor = {
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

export type McpClientLike = {
  listTools(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  close(): Promise<void>
}

export type McpServerDiagnostic = {
  id: string
  enabled: boolean
  transport: McpServerConfig['transport']
  trustScope: McpServerConfig['trustScope']
  available: boolean
  status: 'disabled' | 'connected' | 'error'
  toolCount: number
  catalogFingerprint?: string
  catalogDrift?: boolean
  lastConnectedAt?: string
  lastError?: string
}

export type McpToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: McpServerDiagnostic[]
  search: McpSearchRuntimeDiagnostic
  connectedServers: number
  toolCount: number
  close: () => Promise<void>
}

export type McpToolProviderOptions = {
  clientFactory?: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso?: () => string
}

type McpConnectionState = {
  serverId: string
  server: McpServerConfig
  client: McpClientLike
  clientFactory: (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
  nowIso: () => string
  catalogFingerprint?: string
  catalogDrift?: boolean
  lastConnectedAt?: string
  lastError?: string
}

export async function buildMcpToolProviders(
  config: McpCapabilityConfig | undefined,
  options: McpToolProviderOptions = {}
): Promise<McpToolProviderBuildResult> {
  const providers: CapabilityToolProvider[] = []
  const directProviders: CapabilityToolProvider[] = []
  const diagnostics: McpServerDiagnostic[] = []
  const connected: McpConnectionState[] = []
  const catalogState: McpSearchCatalogState = { records: [] }
  const mcp = config
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const clientFactory = options.clientFactory ?? createSdkMcpClient
  if (!mcp?.enabled) {
    return {
      providers,
      diagnostics,
      search: mcpSearchDiagnostic({
        config: config?.search ?? {
          enabled: false,
          mode: 'auto',
          autoThresholdToolCount: 24,
          topKDefault: 5,
          topKMax: 10,
          minScore: 0.15,
          bm25: { k1: 1.2, b: 0.75 }
        },
        active: false,
        indexedToolCount: 0,
        advertisedToolCount: 0,
        state: catalogState
      }),
      connectedServers: 0,
      toolCount: 0,
      close: async () => undefined
    }
  }

  for (const [serverId, server] of Object.entries(mcp.servers)) {
    if (!server.enabled) {
      diagnostics.push(serverDiagnostic({ serverId, server }, 'disabled', 0))
      continue
    }
    try {
      const client = await clientFactory(serverId, server)
      const state: McpConnectionState = {
        serverId,
        server,
        client,
        clientFactory,
        nowIso,
        lastConnectedAt: nowIso()
      }
      connected.push(state)
      const listed = await refreshMcpConnectionCatalog(state)
      catalogState.records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
      const tools = listed.map((tool) => createMcpLocalTool(state, tool))
      directProviders.push({
        id: `mcp:${serverId}`,
        kind: 'mcp',
        enabled: true,
        available: true,
        tools
      })
      diagnostics.push(serverDiagnostic(state, 'connected', tools.length))
    } catch (error) {
      diagnostics.push(serverDiagnostic({ serverId, server }, 'error', 0, errorMessage(error)))
    }
  }

  const connectedServers = diagnostics.filter((diagnostic) => diagnostic.status === 'connected').length
  const toolCount = catalogState.records.length
  catalogState.lastRefreshedAt = nowIso()
  catalogState.catalogFingerprint = catalogFingerprint(catalogState.records.map((record) => record.toolId))
  const searchActive = shouldUseMcpSearch(mcp.search, toolCount) && connectedServers > 0
  if (searchActive) {
    providers.push(createMcpSearchProvider({
      config: mcp.search,
      state: catalogState,
      refreshCatalog: async () => {
        try {
          const records: McpSearchCatalogRecord[] = []
          const previousFingerprint = catalogState.catalogFingerprint
          for (const state of connected) {
            const listed = await refreshMcpConnectionCatalog(state)
            records.push(...listed.map((tool) => createMcpSearchCatalogRecord(state, tool)))
          }
          catalogState.records = records
          catalogState.lastError = undefined
          catalogState.lastRefreshedAt = nowIso()
          catalogState.catalogFingerprint = catalogFingerprint(records.map((record) => record.toolId))
          catalogState.catalogDrift = Boolean(previousFingerprint && previousFingerprint !== catalogState.catalogFingerprint)
          return records
        } catch (error) {
          catalogState.lastError = redactSecretText(errorMessage(error))
          throw error
        }
      },
      isServerTrusted: isMcpServerTrusted
    }))
  } else {
    providers.push(...directProviders)
  }
  const advertisedToolCount = providers.reduce((total, provider) => total + provider.tools.length, 0)
  return {
    providers,
    diagnostics,
    search: mcpSearchDiagnostic({
      config: mcp.search,
      active: searchActive,
      indexedToolCount: toolCount,
      advertisedToolCount,
      state: catalogState
    }),
    connectedServers,
    toolCount,
    close: async () => {
      await Promise.all(connected.map((state) => state.client.close().catch(() => undefined)))
    }
  }
}

export function normalizeMcpToolName(serverId: string, toolName: string): string {
  return `mcp_${slug(serverId)}_${slug(toolName)}`
}

export function isMcpServerTrusted(server: McpServerConfig, workspace: string): boolean {
  if (server.trustScope === 'user') return true
  const normalizedWorkspace = normalizePathForTrust(workspace)
  return server.trustedWorkspaceRoots.some((root) => {
    const normalizedRoot = normalizePathForTrust(root)
    return normalizedWorkspace === normalizedRoot || normalizedWorkspace.startsWith(`${normalizedRoot}/`)
  })
}

async function createSdkMcpClient(serverId: string, server: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: `kun-${serverId}`, version: '0.1.0' })
  const transport = createTransport(server)
  await client.connect(transport, { timeout: server.timeoutMs })
  return {
    listTools: (options) => {
      const params = options?.cursor ? { cursor: options.cursor } : undefined
      return client.listTools(params, {
        signal: options?.signal,
        timeout: options?.timeout
      })
    },
    callTool: (input, options) => client.callTool(input, undefined, options),
    close: () => client.close()
  }
}

function createTransport(server: McpServerConfig): Transport {
  switch (server.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args,
        env: server.env,
        stderr: 'pipe'
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers }
      })
    case 'sse':
      return new SSEClientTransport(new URL(server.url ?? ''), {
        requestInit: { headers: server.headers },
        eventSourceInit: { fetch: fetchWithHeaders(server.headers) }
      })
  }
}

function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const mergedHeaders = new Headers(init?.headers)
    for (const [key, value] of Object.entries(headers)) {
      mergedHeaders.set(key, value)
    }
    return fetch(input, { ...init, headers: mergedHeaders })
  }
}

function createMcpLocalTool(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): LocalTool {
  return LocalToolHost.defineTool({
    name: normalizeMcpToolName(state.serverId, descriptor.name),
    description: descriptor.description ?? `MCP tool ${descriptor.name} from ${state.serverId}`,
    inputSchema: descriptor.inputSchema ?? { type: 'object' },
    policy: policyFromAnnotations(descriptor.annotations),
    shouldAdvertise: (context: ToolHostContext) => isMcpServerTrusted(state.server, context.workspace),
    execute: async (args, context) => {
      if (!isMcpServerTrusted(state.server, context.workspace)) {
        return {
          output: { error: `MCP server ${state.serverId} is not trusted for this workspace` },
          isError: true
        }
      }
      const result = await callMcpToolWithReconnect(
        state,
        { name: descriptor.name, arguments: args },
        context.abortSignal
      )
      return {
        output: {
          serverId: state.serverId,
          toolName: descriptor.name,
          result
        },
        isError: typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      }
    }
  })
}

async function listAllMcpTools(client: McpClientLike, timeout: number): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = []
  let cursor: string | undefined
  do {
    const listed = await client.listTools({ cursor, timeout })
    tools.push(...listed.tools)
    cursor = listed.nextCursor
  } while (cursor)
  return tools
}

function createMcpSearchCatalogRecord(
  state: McpConnectionState,
  descriptor: McpToolDescriptor
): McpSearchCatalogRecord {
  return {
    toolId: `${state.serverId}/${descriptor.name}`,
    serverId: state.serverId,
    server: state.server,
    client: {
      callTool: (input, options) =>
        callMcpToolWithReconnect(state, input, options?.signal, options?.timeout)
    },
    descriptor,
    normalizedName: normalizeMcpToolName(state.serverId, descriptor.name),
    policy: policyFromAnnotations(descriptor.annotations)
  }
}

async function refreshMcpConnectionCatalog(state: McpConnectionState): Promise<McpToolDescriptor[]> {
  const listed = await listAllMcpTools(state.client, state.server.timeoutMs)
  const nextFingerprint = catalogFingerprint(listed.map((tool) => tool.name))
  state.catalogDrift = Boolean(state.catalogFingerprint && state.catalogFingerprint !== nextFingerprint)
  state.catalogFingerprint = nextFingerprint
  state.lastError = undefined
  return listed
}

async function callMcpToolWithReconnect(
  state: McpConnectionState,
  input: { name: string; arguments: Record<string, unknown> },
  signal: AbortSignal | undefined,
  timeout = state.server.timeoutMs
): Promise<unknown> {
  try {
    return await state.client.callTool(input, { signal, timeout })
  } catch (error) {
    state.lastError = redactSecretText(errorMessage(error))
    if (signal?.aborted) throw error
    const client = await reconnectMcpConnection(state)
    return client.callTool(input, { signal, timeout })
  }
}

async function reconnectMcpConnection(state: McpConnectionState): Promise<McpClientLike> {
  await state.client.close().catch(() => undefined)
  const client = await state.clientFactory(state.serverId, state.server)
  state.client = client
  state.lastConnectedAt = state.nowIso()
  state.lastError = undefined
  return client
}

function shouldUseMcpSearch(config: NonNullable<McpCapabilityConfig['search']>, toolCount: number): boolean {
  if (!config.enabled) return false
  if (config.mode === 'direct') return false
  if (config.mode === 'search') return true
  return toolCount >= config.autoThresholdToolCount
}

function policyFromAnnotations(annotation: McpToolDescriptor['annotations']): LocalTool['policy'] {
  if (annotation?.readOnlyHint && !annotation.openWorldHint && !annotation.destructiveHint) return 'auto'
  if (annotation?.destructiveHint) return 'on-request'
  if (annotation?.openWorldHint) return 'untrusted'
  return 'on-request'
}

function serverDiagnostic(
  state: { serverId: string; server: McpServerConfig; catalogFingerprint?: string; catalogDrift?: boolean; lastConnectedAt?: string },
  status: McpServerDiagnostic['status'],
  toolCount: number,
  lastError?: string
): McpServerDiagnostic {
  return {
    id: state.serverId,
    enabled: state.server.enabled,
    transport: state.server.transport,
    trustScope: state.server.trustScope,
    available: status === 'connected',
    status,
    toolCount,
    ...(state.catalogFingerprint ? { catalogFingerprint: state.catalogFingerprint } : {}),
    ...(state.catalogDrift !== undefined ? { catalogDrift: state.catalogDrift } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
    ...(lastError ? { lastError: redactSecretText(lastError) } : {})
  }
}

function catalogFingerprint(values: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...values].sort()))
    .digest('hex')
    .slice(0, 16)
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

function normalizePathForTrust(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
