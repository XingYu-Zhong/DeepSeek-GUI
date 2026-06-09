import type {
  ToolHostContext,
  ToolProviderKind,
  ToolProviderPolicy
} from '../../ports/tool-host.js'
import type { LocalTool } from './local-tool-host.js'

export type CapabilityToolRecord = {
  provider: ToolProviderPolicy
  tool: LocalTool
}

export type CapabilityToolProvider = ToolProviderPolicy & {
  tools: readonly LocalTool[]
}

export type CapabilityToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  providerId: string
  providerKind: ToolProviderKind
}

export class CapabilityRegistry {
  private readonly providers = new Map<string, CapabilityToolProvider>()
  private readonly tools = new Map<string, CapabilityToolRecord>()

  static fromLocalTools(tools: readonly LocalTool[]): CapabilityRegistry {
    return new CapabilityRegistry([
      {
        id: 'builtin',
        kind: 'built-in',
        enabled: true,
        available: true,
        tools
      }
    ])
  }

  constructor(providers: readonly CapabilityToolProvider[] = []) {
    for (const provider of providers) {
      this.registerProvider(provider)
    }
  }

  registerProvider(provider: CapabilityToolProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`duplicate tool provider: ${provider.id}`)
    }
    this.providers.set(provider.id, provider)
    for (const tool of provider.tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`duplicate tool name: ${tool.name}`)
      }
      this.tools.set(tool.name, { provider: providerPolicy(provider), tool })
    }
  }

  listTools(context?: ToolHostContext): CapabilityToolSpec[] {
    const specs: CapabilityToolSpec[] = []
    for (const record of this.tools.values()) {
      if (!this.canUseProvider(record.provider, context)) continue
      if (!this.canUseTool(record.tool.name, context)) continue
      if (record.tool.shouldAdvertise) {
        if (!context || !record.tool.shouldAdvertise(context)) continue
      }
      specs.push({
        name: record.tool.name,
        description: record.tool.description,
        inputSchema: record.tool.inputSchema,
        toolKind: record.tool.toolKind,
        providerId: record.provider.id,
        providerKind: record.provider.kind
      })
    }
    return specs
  }

  resolveTool(toolName: string, context: ToolHostContext, providerId?: string): CapabilityToolRecord {
    const record = this.tools.get(toolName)
    if (!record) {
      throw new Error(`unknown tool: ${toolName}`)
    }
    if (providerId && providerId !== record.provider.id) {
      throw new Error(`tool ${toolName} is not provided by ${providerId}`)
    }
    if (!this.canUseProvider(record.provider, context)) {
      throw new Error(`tool ${toolName} is not advertised by provider ${record.provider.id}`)
    }
    if (!this.canUseTool(toolName, context)) {
      throw new Error(`tool ${toolName} is not advertised by active tool policy`)
    }
    if (record.tool.shouldAdvertise && !record.tool.shouldAdvertise(context)) {
      throw new Error(`tool ${toolName} is not advertised in this turn context`)
    }
    return record
  }

  diagnostics(): ToolProviderPolicy[] {
    return [...this.providers.values()].map(providerPolicy)
  }

  private canUseProvider(provider: ToolProviderPolicy, context?: ToolHostContext): boolean {
    if (!provider.enabled || !provider.available) return false
    const allowed = context?.allowedProviderIds
    if (allowed && !allowed.includes(provider.id)) return false
    return true
  }

  private canUseTool(toolName: string, context?: ToolHostContext): boolean {
    const allowed = context?.allowedToolNames
    return !allowed || allowed.includes(toolName)
  }
}

function providerPolicy(provider: ToolProviderPolicy): ToolProviderPolicy {
  return {
    id: provider.id,
    kind: provider.kind,
    enabled: provider.enabled,
    available: provider.available,
    ...(provider.reason ? { reason: provider.reason } : {})
  }
}
