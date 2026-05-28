import type { AgentProvider, AgentProviderId } from './types'
import { CodewhaleRuntimeProvider } from './codewhale-runtime'
import { defaultAgentProviderId, isKnownAgentProviderId } from './catalog'

const providerFactories: Record<AgentProviderId, () => AgentProvider> = {
  codewhale: () => new CodewhaleRuntimeProvider()
}

const providerCache = new Map<AgentProviderId, AgentProvider>()

export function getProvider(id: AgentProviderId): AgentProvider {
  const providerId = isKnownAgentProviderId(id) ? id : defaultAgentProviderId()
  const cached = providerCache.get(providerId)
  if (cached) return cached
  const created = providerFactories[providerId]()
  providerCache.set(providerId, created)
  return created
}

export function resetProviderCacheForTests(): void {
  providerCache.clear()
}
