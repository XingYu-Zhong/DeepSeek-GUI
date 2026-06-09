import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

export async function listSkills(runtime: ServerRuntime): Promise<JsonResponse> {
  const diagnostics = runtime.skills
    ? await runtime.skills()
    : {
        enabled: false,
        roots: [],
        skills: [],
        validationErrors: [],
        lastActivations: []
      }
  return jsonResponse({
    enabled: diagnostics.enabled,
    roots: diagnostics.roots,
    skills: diagnostics.skills,
    validationErrors: diagnostics.validationErrors
  })
}
