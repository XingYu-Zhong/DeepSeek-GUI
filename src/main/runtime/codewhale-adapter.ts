import type { AgentProviderId } from '../../shared/agent-catalog'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { getActiveAgentRuntimeSettings } from '../../shared/app-settings'
import { syncDeepseekTuiConfig } from '../deepseek-config'
import {
  inspectDeepseekLaunchConfig,
  isDeepseekChildRunning,
  reclaimDeepseekPort,
  startDeepseekChild,
  stopDeepseekChildAndWait
} from '../deepseek-process'
import { resolveDeepseekExecutable } from '../resolve-deepseek-binary'
import { getRuntimeBaseUrl } from '../settings-store'
import type { LocalHttpRuntimeAdapter } from './local-http-runtime-adapter'

export const codewhaleRuntimeAdapter: LocalHttpRuntimeAdapter = {
  id: 'codewhale',

  resolveExecutable(settings: AppSettingsV1) {
    return resolveDeepseekExecutable(getActiveAgentRuntimeSettings(settings).binaryPath)
  },

  async ensureRunning(settings: AppSettingsV1) {
    await syncDeepseekTuiConfig(settings)
    await startDeepseekChild(settings)
  },

  stopAndWait() {
    return stopDeepseekChildAndWait()
  },

  isChildRunning() {
    return isDeepseekChildRunning()
  },

  getBaseUrl(settings: AppSettingsV1) {
    return getRuntimeBaseUrl(getActiveAgentRuntimeSettings(settings).port)
  },

  syncConfig(settings: AppSettingsV1, previous?: AppSettingsV1) {
    return syncDeepseekTuiConfig(settings, previous)
  },

  reclaimPort(port: number) {
    return reclaimDeepseekPort(port)
  },

  inspectLaunchConfig(settings: AppSettingsV1) {
    return inspectDeepseekLaunchConfig(settings)
  }
}

const adapters: Record<AgentProviderId, LocalHttpRuntimeAdapter> = {
  codewhale: codewhaleRuntimeAdapter
}

export function getRuntimeAdapter(providerId: AgentProviderId): LocalHttpRuntimeAdapter {
  return adapters[providerId]
}

export function getActiveRuntimeAdapter(settings: AppSettingsV1): LocalHttpRuntimeAdapter {
  return getRuntimeAdapter(settings.agentProvider)
}
