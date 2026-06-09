import { RuntimeInfoResponse } from '../../contracts/runtime-info.js'
import { redactSecrets } from '../../config/secret-redaction.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

export function runtimeInfoJsonResponse(runtime: ServerRuntime): JsonResponse {
  return jsonResponse(RuntimeInfoResponse.parse(runtime.info()))
}

export async function runtimeToolDiagnosticsJsonResponse(runtime: ServerRuntime): Promise<JsonResponse> {
  return jsonResponse(redactSecrets(await (runtime.toolDiagnostics?.() ?? {
    providers: [],
    mcpServers: [],
    webProviders: [],
    skills: {
      enabled: false,
      roots: [],
      skills: [],
      validationErrors: [],
      lastActivations: []
    },
    attachments: {
      enabled: false,
      rootDir: '',
      count: 0,
      totalBytes: 0
    },
    memory: {
      enabled: false,
      rootDir: '',
      activeCount: 0,
      tombstoneCount: 0,
      lastInjectedIds: []
    }
  })))
}
