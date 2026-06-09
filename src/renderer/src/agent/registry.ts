import type { AgentProvider } from './types'
import { KunRuntimeProvider } from './kun-runtime'

let cachedProvider: AgentProvider | null = null

export function getProvider(): AgentProvider {
  if (cachedProvider) return cachedProvider
  cachedProvider = new KunRuntimeProvider()
  return cachedProvider
}

export function resetProviderCacheForTests(): void {
  cachedProvider = null
}
