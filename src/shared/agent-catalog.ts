export type AgentProviderId = 'codewhale'

export type LocalHttpRuntimeCapabilities = {
  interrupt: boolean
  stream: boolean
  approvals: boolean
  attachFiles: boolean
  managedBinary: boolean
}

export type AgentProviderDefinition = {
  id: AgentProviderId
  displayName: string
  settingsKey: AgentProviderId
  capabilities: LocalHttpRuntimeCapabilities
  defaultPort: number
}

export const AGENT_CATALOG: AgentProviderDefinition[] = [
  {
    id: 'codewhale',
    displayName: 'CodeWhale',
    settingsKey: 'codewhale',
    capabilities: {
      interrupt: true,
      stream: true,
      approvals: true,
      attachFiles: false,
      managedBinary: true
    },
    defaultPort: 7878
  }
]

export function defaultAgentProviderId(): AgentProviderId {
  return 'codewhale'
}

export function normalizeAgentProviderId(value: unknown): AgentProviderId {
  if (value === 'codewhale' || value === 'deepseek-runtime') return 'codewhale'
  return defaultAgentProviderId()
}

export function getAgentDefinition(id: AgentProviderId): AgentProviderDefinition {
  const found = AGENT_CATALOG.find((entry) => entry.id === id)
  if (!found) {
    throw new Error(`Unknown agent provider: ${id}`)
  }
  return found
}

export function listAgents(): AgentProviderDefinition[] {
  return [...AGENT_CATALOG]
}

export function isKnownAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string' && AGENT_CATALOG.some((entry) => entry.id === value)
}
