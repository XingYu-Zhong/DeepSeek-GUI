import { z } from 'zod'

export const RUNTIME_CAPABILITY_CONTRACT_VERSION = 1

export const RuntimeCapabilityStatus = z.enum(['available', 'disabled', 'unavailable'])
export type RuntimeCapabilityStatus = z.infer<typeof RuntimeCapabilityStatus>

export const RuntimeCapabilityState = z
  .object({
    status: RuntimeCapabilityStatus,
    enabled: z.boolean(),
    available: z.boolean(),
    reason: z.string().optional()
  })
  .strict()
export type RuntimeCapabilityState = z.infer<typeof RuntimeCapabilityState>

export const ModelInputModality = z.enum(['text', 'image'])
export type ModelInputModality = z.infer<typeof ModelInputModality>

export const ModelMessagePartSupport = z.enum(['text', 'image_url', 'input_image'])
export type ModelMessagePartSupport = z.infer<typeof ModelMessagePartSupport>

export const ModelCapabilityMetadata = z
  .object({
    id: z.string().min(1),
    inputModalities: z.array(ModelInputModality).min(1),
    outputModalities: z.array(ModelInputModality).min(1),
    supportsToolCalling: z.boolean(),
    contextWindowTokens: z.number().int().positive().optional(),
    messageParts: z.array(ModelMessagePartSupport).min(1)
  })
  .strict()
export type ModelCapabilityMetadata = z.infer<typeof ModelCapabilityMetadata>

const CapabilityToggleConfig = z
  .object({
    enabled: z.boolean().default(false)
  })
  .strict()

const StringRecord = z.record(z.string(), z.string())

export const McpTransportKind = z.enum(['stdio', 'streamable-http', 'sse'])
export type McpTransportKind = z.infer<typeof McpTransportKind>

export const McpTrustScope = z.enum(['user', 'workspace'])
export type McpTrustScope = z.infer<typeof McpTrustScope>

export const McpToolDiscoveryMode = z.enum(['direct', 'search', 'auto'])
export type McpToolDiscoveryMode = z.infer<typeof McpToolDiscoveryMode>

export const McpSearchConfig = z
  .object({
    enabled: z.boolean().default(false),
    mode: McpToolDiscoveryMode.default('auto'),
    autoThresholdToolCount: z.number().int().positive().default(24),
    topKDefault: z.number().int().positive().default(5),
    topKMax: z.number().int().positive().default(10),
    minScore: z.number().nonnegative().default(0.15),
    bm25: z
      .object({
        k1: z.number().positive().default(1.2),
        b: z.number().min(0).max(1).default(0.75)
      })
      .strict()
      .default(() => ({ k1: 1.2, b: 0.75 }))
  })
  .strict()
  .superRefine((search, ctx) => {
    if (search.topKDefault > search.topKMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['topKDefault'],
        message: 'topKDefault must be less than or equal to topKMax'
      })
    }
  })
export type McpSearchConfig = z.infer<typeof McpSearchConfig>

export const McpServerConfig = z
  .object({
    enabled: z.boolean().default(true),
    transport: McpTransportKind,
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    url: z.string().min(1).optional(),
    headers: StringRecord.default({}),
    env: StringRecord.default({}),
    trustScope: McpTrustScope.default('workspace'),
    trustedWorkspaceRoots: z.array(z.string().min(1)).default([]),
    timeoutMs: z.number().int().positive().default(30_000)
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'stdio MCP servers require command'
      })
    }
    if ((server.transport === 'streamable-http' || server.transport === 'sse') && !server.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `${server.transport} MCP servers require url`
      })
    }
    if (server.url) {
      try {
        const parsed = new URL(server.url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: 'MCP server url must use http or https'
          })
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP server url must be a valid URL'
        })
      }
    }
    if (server.trustScope === 'workspace' && server.trustedWorkspaceRoots.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['trustedWorkspaceRoots'],
        message: 'workspace-scoped MCP servers require at least one trusted workspace root'
      })
    }
  })
export type McpServerConfig = z.infer<typeof McpServerConfig>

export const McpCapabilityConfig = CapabilityToggleConfig.extend({
  servers: z.record(z.string().min(1), McpServerConfig).default({}),
  search: McpSearchConfig.default(() => McpSearchConfig.parse({}))
}).strict()
export type McpCapabilityConfig = z.infer<typeof McpCapabilityConfig>

export const WebCapabilityConfig = CapabilityToggleConfig.extend({
  fetchEnabled: z.boolean().default(false),
  searchEnabled: z.boolean().default(false),
  provider: z.string().min(1).optional(),
  allowDomains: z.array(z.string().min(1)).default([]),
  denyDomains: z.array(z.string().min(1)).default([])
}).strict()
export type WebCapabilityConfig = z.infer<typeof WebCapabilityConfig>

export const SkillsCapabilityConfig = CapabilityToggleConfig.extend({
  roots: z.array(z.string().min(1)).default([]),
  legacySkillMd: z.boolean().default(true)
}).strict()
export type SkillsCapabilityConfig = z.infer<typeof SkillsCapabilityConfig>

export const SubagentsCapabilityConfig = CapabilityToggleConfig.extend({
  maxParallel: z.number().int().nonnegative().default(0),
  maxChildRuns: z.number().int().nonnegative().default(0),
  // Accept the removed legacy field so old configs keep loading, but ignore it.
  defaultStepLimit: z.number().int().positive().optional()
})
  .strict()
  .transform(({ defaultStepLimit: _legacyDefaultStepLimit, ...config }) => config)
export type SubagentsCapabilityConfig = z.output<typeof SubagentsCapabilityConfig>

export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES = 512 * 1024
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION = 1280
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE = 'image/webp'

export const AttachmentsCapabilityConfig = CapabilityToggleConfig.extend({
  maxImageBytes: z.number().int().positive().default(5 * 1024 * 1024),
  maxImageDimension: z.number().int().positive().default(4096),
  allowedMimeTypes: z.array(z.string().min(1)).default(['image/png', 'image/jpeg', 'image/webp']),
  textFallbackMaxBase64Bytes: z.number().int().positive().default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES),
  textFallbackMaxImageDimension: z.number().int().positive().default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION),
  textFallbackPreferredMimeType: z.string().min(1).default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE)
}).strict()
export type AttachmentsCapabilityConfig = z.infer<typeof AttachmentsCapabilityConfig>

export const MemoryCapabilityConfig = CapabilityToggleConfig.extend({
  scopes: z.array(z.enum(['user', 'workspace', 'project'])).default(['user', 'workspace', 'project']),
  maxInjectedRecords: z.number().int().positive().default(8)
}).strict()
export type MemoryCapabilityConfig = z.infer<typeof MemoryCapabilityConfig>

export const KunCapabilitiesConfig = z
  .object({
    mcp: McpCapabilityConfig.default(() => McpCapabilityConfig.parse({})),
    web: WebCapabilityConfig.default(() => WebCapabilityConfig.parse({})),
    skills: SkillsCapabilityConfig.default(() => SkillsCapabilityConfig.parse({})),
    subagents: SubagentsCapabilityConfig.default(() => SubagentsCapabilityConfig.parse({})),
    attachments: AttachmentsCapabilityConfig.default(() => AttachmentsCapabilityConfig.parse({})),
    memory: MemoryCapabilityConfig.default(() => MemoryCapabilityConfig.parse({}))
  })
  .strict()
export type KunCapabilitiesConfig = z.infer<typeof KunCapabilitiesConfig>

export const DEFAULT_KUN_CAPABILITIES_CONFIG: KunCapabilitiesConfig = KunCapabilitiesConfig.parse({})

export const RuntimeCapabilityManifest = z
  .object({
    contractVersion: z.literal(RUNTIME_CAPABILITY_CONTRACT_VERSION),
    model: ModelCapabilityMetadata,
    cli: z
      .object({
        serve: RuntimeCapabilityState,
        run: RuntimeCapabilityState,
        chat: RuntimeCapabilityState,
        exec: RuntimeCapabilityState
      })
      .strict(),
    mcp: RuntimeCapabilityState.extend({
      configuredServers: z.number().int().nonnegative(),
      connectedServers: z.number().int().nonnegative(),
      toolCount: z.number().int().nonnegative(),
      search: z
        .object({
          enabled: z.boolean(),
          mode: McpToolDiscoveryMode,
          active: z.boolean(),
          indexedToolCount: z.number().int().nonnegative(),
          advertisedToolCount: z.number().int().nonnegative()
        })
        .strict()
    }).strict(),
    web: RuntimeCapabilityState.extend({
      fetch: RuntimeCapabilityState,
      search: RuntimeCapabilityState,
      provider: z.string().optional()
    }).strict(),
    skills: RuntimeCapabilityState.extend({
      configuredRoots: z.number().int().nonnegative(),
      discoveredSkills: z.number().int().nonnegative()
    }).strict(),
    subagents: RuntimeCapabilityState.extend({
      maxParallel: z.number().int().nonnegative(),
      maxChildRuns: z.number().int().nonnegative()
    }).strict(),
    attachments: RuntimeCapabilityState.extend({
      maxImageBytes: z.number().int().positive(),
      maxImageDimension: z.number().int().positive(),
      allowedMimeTypes: z.array(z.string().min(1)),
      textFallbackMaxBase64Bytes: z.number().int().positive(),
      textFallbackMaxImageDimension: z.number().int().positive(),
      textFallbackPreferredMimeType: z.string().min(1)
    }).strict(),
    memory: RuntimeCapabilityState.extend({
      scopes: z.array(z.enum(['user', 'workspace', 'project'])),
      maxInjectedRecords: z.number().int().positive()
    }).strict()
  })
  .strict()
export type RuntimeCapabilityManifest = z.infer<typeof RuntimeCapabilityManifest>

export function buildRuntimeCapabilityManifest(input: {
  config?: KunCapabilitiesConfig
  model: ModelCapabilityMetadata
  mcp?: {
    configuredServers?: number
    connectedServers?: number
    toolCount?: number
    lastError?: string
    search?: {
      active?: boolean
      indexedToolCount?: number
      advertisedToolCount?: number
    }
  }
  web?: {
    fetchAvailable?: boolean
    searchAvailable?: boolean
    provider?: string
    reason?: string
  }
  skills?: {
    configuredRoots?: number
    discoveredSkills?: number
    reason?: string
  }
  attachments?: {
    available?: boolean
    reason?: string
  }
  memory?: {
    available?: boolean
    reason?: string
  }
  subagents?: {
    available?: boolean
    reason?: string
  }
}): RuntimeCapabilityManifest {
  const config = KunCapabilitiesConfig.parse(input.config ?? {})
  const configuredMcpServers = input.mcp?.configuredServers ?? Object.keys(config.mcp.servers).length
  const connectedMcpServers = input.mcp?.connectedServers ?? 0
  const mcpToolCount = input.mcp?.toolCount ?? 0
  const mcpState = mcpCapabilityState(config.mcp.enabled, connectedMcpServers, input.mcp?.lastError)
  const webFetchState = providerCapabilityState(
    config.web.enabled && config.web.fetchEnabled,
    'web fetch is disabled by config',
    input.web?.fetchAvailable === true,
    input.web?.reason ?? 'web fetch provider is unavailable'
  )
  const webSearchState = providerCapabilityState(
    config.web.enabled && config.web.searchEnabled,
    'web search is disabled by config',
    input.web?.searchAvailable === true,
    input.web?.reason ?? 'web search provider is unavailable'
  )
  const webState = webCapabilityState(config.web.enabled, webFetchState, webSearchState, input.web?.reason)
  const configuredSkillRoots = input.skills?.configuredRoots ?? config.skills.roots.length
  const discoveredSkills = input.skills?.discoveredSkills ?? 0
  const skillsState = skillsCapabilityState(config.skills.enabled, discoveredSkills, input.skills?.reason)
  return RuntimeCapabilityManifest.parse({
    contractVersion: RUNTIME_CAPABILITY_CONTRACT_VERSION,
    model: input.model,
    cli: {
      serve: available(),
      run: unavailable('not implemented'),
      chat: unavailable('not implemented'),
      exec: unavailable('not implemented')
    },
    mcp: {
      ...mcpState,
      configuredServers: configuredMcpServers,
      connectedServers: connectedMcpServers,
      toolCount: mcpToolCount,
      search: {
        enabled: config.mcp.search.enabled,
        mode: config.mcp.search.mode,
        active: input.mcp?.search?.active ?? false,
        indexedToolCount: input.mcp?.search?.indexedToolCount ?? mcpToolCount,
        advertisedToolCount: input.mcp?.search?.advertisedToolCount ?? mcpToolCount
      }
    },
    web: {
      ...webState,
      fetch: webFetchState,
      search: webSearchState,
      provider: input.web?.provider ?? config.web.provider
    },
    skills: {
      ...skillsState,
      configuredRoots: configuredSkillRoots,
      discoveredSkills
    },
    subagents: {
      ...providerCapabilityState(
        config.subagents.enabled,
        'subagents are disabled by config',
        input.subagents?.available === true,
        input.subagents?.reason ?? 'subagent runtime is unavailable'
      ),
      maxParallel: config.subagents.maxParallel,
      maxChildRuns: config.subagents.maxChildRuns
    },
    attachments: {
      ...providerCapabilityState(
        config.attachments.enabled,
        'attachments are disabled by config',
        input.attachments?.available === true,
        input.attachments?.reason ?? 'attachment store is unavailable'
      ),
      maxImageBytes: config.attachments.maxImageBytes,
      maxImageDimension: config.attachments.maxImageDimension,
      allowedMimeTypes: config.attachments.allowedMimeTypes,
      textFallbackMaxBase64Bytes: config.attachments.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: config.attachments.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: config.attachments.textFallbackPreferredMimeType
    },
    memory: {
      ...providerCapabilityState(
        config.memory.enabled,
        'memory is disabled by config',
        input.memory?.available === true,
        input.memory?.reason ?? 'memory store is unavailable'
      ),
      scopes: config.memory.scopes,
      maxInjectedRecords: config.memory.maxInjectedRecords
    }
  })
}

function available(): RuntimeCapabilityState {
  return { status: 'available', enabled: true, available: true }
}

function unavailable(reason: string): RuntimeCapabilityState {
  return { status: 'unavailable', enabled: false, available: false, reason }
}

function stateFromEnabled(
  enabled: boolean,
  disabledReason: string,
  unavailableReason: string
): RuntimeCapabilityState {
  return enabled
    ? { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
    : { status: 'disabled', enabled: false, available: false, reason: disabledReason }
}

function providerCapabilityState(
  enabled: boolean,
  disabledReason: string,
  availableProvider: boolean,
  unavailableReason: string
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: disabledReason }
  return availableProvider
    ? { status: 'available', enabled: true, available: true }
    : { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
}

function webCapabilityState(
  enabled: boolean,
  fetchState: RuntimeCapabilityState,
  searchState: RuntimeCapabilityState,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'web access is disabled by config' }
  if (fetchState.available || searchState.available) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: reason ?? 'no web providers available'
  }
}

function skillsCapabilityState(
  enabled: boolean,
  discoveredSkills: number,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'Skills are disabled by config' }
  if (discoveredSkills > 0) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: reason ?? 'no Skills discovered'
  }
}

function mcpCapabilityState(
  enabled: boolean,
  connectedServers: number,
  lastError: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'MCP is disabled by config' }
  if (connectedServers > 0) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: lastError ?? 'no MCP servers connected'
  }
}
