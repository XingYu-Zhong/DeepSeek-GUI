import type { AgentProvider, AgentProviderId } from './types'
import { KunRuntimeProvider } from './kun-runtime'

export type AgentProviderStatus = 'available' | 'planned'

export type AgentProviderDescriptor = {
  id: AgentProviderId
  displayName: string
  status: AgentProviderStatus
  description: string
}

const agentProviderDescriptors: AgentProviderDescriptor[] = [
  {
    id: 'kun',
    displayName: 'Kun',
    status: 'available',
    description: 'Bundled HTTP/SSE runtime used by DeepSeek-GUI.'
  },
  {
    id: 'codex-cli',
    displayName: 'Codex CLI',
    status: 'planned',
    description: 'External coding-agent CLI provider planned for future integration.'
  }
]

const cachedProviders = new Map<AgentProviderId, AgentProvider>()

export function listAgentProviderDescriptors(): AgentProviderDescriptor[] {
  return agentProviderDescriptors.map((descriptor) => ({ ...descriptor }))
}

export function getAgentProviderDescriptor(providerId: AgentProviderId): AgentProviderDescriptor {
  const descriptor = agentProviderDescriptors.find((entry) => entry.id === providerId)
  if (!descriptor) throw new Error(`Unknown agent provider: ${providerId}`)
  return { ...descriptor }
}

export function getProvider(providerId: AgentProviderId = 'kun'): AgentProvider {
  const cachedProvider = cachedProviders.get(providerId)
  if (cachedProvider) return cachedProvider

  if (providerId !== 'kun') {
    throw new Error(`Agent provider is not implemented yet: ${providerId}`)
  }

  const provider = new KunRuntimeProvider()
  cachedProviders.set(providerId, provider)
  return provider
}

export function resetProviderCacheForTests(): void {
  cachedProviders.clear()
}
