import type { AgentProviderId } from '../../shared/agent-catalog'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { getActiveAgentRuntimeSettings } from '../../shared/app-settings'

export interface LocalHttpRuntimeAdapter {
  readonly id: AgentProviderId
  resolveExecutable(settings: AppSettingsV1): Promise<string>
  ensureRunning(settings: AppSettingsV1): Promise<void>
  stopAndWait(): Promise<void>
  isChildRunning(): boolean
  getBaseUrl(settings: AppSettingsV1): string
  syncConfig(settings: AppSettingsV1, previous?: AppSettingsV1): Promise<void>
  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }>
  inspectLaunchConfig(
    settings: AppSettingsV1
  ): Promise<
    | { state: 'absent' }
    | { state: 'non-deepseek'; pid: number; command: string }
    | { state: 'deepseek'; pid: number; command: string; matches: true }
    | { state: 'deepseek'; pid: number; command: string; matches: false; reason: string }
  >
}

export function runtimeAuthHeaders(settings: AppSettingsV1): Headers {
  const runtime = getActiveAgentRuntimeSettings(settings)
  const headers = new Headers()
  if (runtime.runtimeToken.trim()) {
    headers.set('Authorization', `Bearer ${runtime.runtimeToken.trim()}`)
  }
  return headers
}
