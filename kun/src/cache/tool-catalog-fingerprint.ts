import { createHash } from 'node:crypto'
import type { ModelToolSpec } from '../ports/model-client.js'

export type ToolCatalogFingerprint = {
  fingerprint: string
  toolCount: number
  toolNames: string[]
  toolHashes: Record<string, string>
}

export function buildToolCatalogFingerprint(
  tools: readonly ModelToolSpec[]
): ToolCatalogFingerprint {
  const canonicalTools = normalizeToolSpecs(tools)
	  return {
	    fingerprint: hashObject(canonicalTools),
	    toolCount: canonicalTools.length,
	    toolNames: canonicalTools.map((tool) => tool.name),
	    toolHashes: Object.fromEntries(canonicalTools.map((tool) => [tool.name, hashObject(tool)]))
	  }
	}

function normalizeToolSpecs(tools: readonly ModelToolSpec[]): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: canonicalizeSchema(tool.inputSchema)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function canonicalizeSchema(value: unknown): Record<string, unknown> {
  const canonical = canonicalize(value)
  return canonical && typeof canonical === 'object' && !Array.isArray(canonical)
    ? canonical as Record<string, unknown>
    : {}
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return out
}

function hashObject(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}
