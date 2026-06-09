import { createHash } from 'node:crypto'
import type { TurnItem } from '../contracts/items.js'

/**
 * Pieces of the prefix that may change through the explicit mutation
 * methods. Each mutator invalidates the fingerprint and the next read
 * recomputes it.
 */
export type ImmutablePrefix = {
  systemPrompt: string
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  /** Skill, project, and user constraints that must outlive compaction. */
  pinnedConstraints: string[]
  fewShots: TurnItem[]
  /** Stable fingerprint of the prefix. Updated by `setSystemPrompt`, etc. */
  fingerprint: string
  /** Sequence number that increments on every explicit mutation. */
  revision: number
}

const VERIFY_IMMUTABLE_PREFIX_IN_PROD = process.env.KUN_VERIFY_IMMUTABLE_PREFIX === '1'

function hashObject(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
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

function canonicalizeSchema(value: unknown): Record<string, unknown> {
  const canonical = canonicalize(value)
  return canonical && typeof canonical === 'object' && !Array.isArray(canonical)
    ? canonical as Record<string, unknown>
    : {}
}

function normalizeTools(tools: ImmutablePrefix['tools']): ImmutablePrefix['tools'] {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: canonicalizeSchema(tool.inputSchema)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function fewShotCacheShape(item: TurnItem): unknown {
  switch (item.kind) {
    case 'user_message':
      return { kind: item.kind, text: item.text }
    case 'assistant_text':
      return { kind: item.kind, text: item.text }
    case 'tool_call':
      return {
        kind: item.kind,
        callId: item.callId,
        toolName: item.toolName,
        arguments: canonicalize(item.arguments)
      }
    case 'tool_result':
      return {
        kind: item.kind,
        callId: item.callId,
        output: canonicalize(item.output)
      }
    case 'assistant_reasoning':
    case 'approval':
    case 'user_input':
    case 'compaction':
    case 'error':
      return null
  }
}

function buildFingerprint(input: {
  systemPrompt: string
  tools: ImmutablePrefix['tools']
  pinnedConstraints: string[]
  fewShots: TurnItem[]
}): string {
  return hashObject({
    systemPrompt: input.systemPrompt,
    tools: normalizeTools(input.tools),
    pinned: input.pinnedConstraints,
    fewShots: input.fewShots.map(fewShotCacheShape).filter((item) => item !== null)
  })
}

export function shouldVerifyImmutablePrefix(): boolean {
  return process.env.NODE_ENV !== 'production' || VERIFY_IMMUTABLE_PREFIX_IN_PROD
}

export function createImmutablePrefix(input?: {
  systemPrompt?: string
  tools?: ImmutablePrefix['tools']
  pinnedConstraints?: string[]
  fewShots?: TurnItem[]
}): ImmutablePrefix {
  const systemPrompt = input?.systemPrompt ?? ''
  const tools = normalizeTools(input?.tools ?? [])
  const pinnedConstraints = [...(input?.pinnedConstraints ?? [])]
  const fewShots = [...(input?.fewShots ?? [])]
  return {
    systemPrompt,
    tools,
    pinnedConstraints,
    fewShots,
    fingerprint: buildFingerprint({ systemPrompt, tools, pinnedConstraints, fewShots }),
    revision: 1
  }
}

function mutate(
  prefix: ImmutablePrefix,
  patch: Partial<Omit<ImmutablePrefix, 'fingerprint' | 'revision'>>
): ImmutablePrefix {
  const tools = patch.tools ? normalizeTools(patch.tools) : prefix.tools
  const pinnedConstraints = patch.pinnedConstraints
    ? [...patch.pinnedConstraints]
    : prefix.pinnedConstraints
  const fewShots = patch.fewShots ? [...patch.fewShots] : prefix.fewShots
  const systemPrompt = patch.systemPrompt ?? prefix.systemPrompt
  const next: ImmutablePrefix = {
    ...prefix,
    ...patch,
    systemPrompt,
    tools,
    pinnedConstraints,
    fewShots,
    fingerprint: buildFingerprint({ systemPrompt, tools, pinnedConstraints, fewShots }),
    revision: prefix.revision + 1
  }
  return next
}

export function setSystemPrompt(prefix: ImmutablePrefix, systemPrompt: string): ImmutablePrefix {
  return mutate(prefix, { systemPrompt })
}

export function setTools(
  prefix: ImmutablePrefix,
  tools: ImmutablePrefix['tools']
): ImmutablePrefix {
  return mutate(prefix, { tools })
}

export function setPinnedConstraints(prefix: ImmutablePrefix, pinned: string[]): ImmutablePrefix {
  return mutate(prefix, { pinnedConstraints: pinned })
}

export function setFewShots(prefix: ImmutablePrefix, fewShots: TurnItem[]): ImmutablePrefix {
  return mutate(prefix, { fewShots })
}

export function verifyImmutablePrefix(prefix: ImmutablePrefix): string {
  const expected = buildFingerprint(prefix)
  if (expected !== prefix.fingerprint) {
    throw new Error(
      `immutable prefix fingerprint drift: expected ${prefix.fingerprint}, actual ${expected}`
    )
  }
  return expected
}

export function describeFingerprintDrift(
  before: ImmutablePrefix,
  after: ImmutablePrefix
): { drift: boolean; changedFields: string[] } {
  const changed: string[] = []
  if (before.systemPrompt !== after.systemPrompt) changed.push('systemPrompt')
  if (hashObject(normalizeTools(before.tools)) !== hashObject(normalizeTools(after.tools))) {
    changed.push('tools')
  }
  if (hashObject(before.pinnedConstraints) !== hashObject(after.pinnedConstraints))
    changed.push('pinnedConstraints')
  if (
    hashObject(before.fewShots.map(fewShotCacheShape).filter((item) => item !== null)) !==
    hashObject(after.fewShots.map(fewShotCacheShape).filter((item) => item !== null))
  ) {
    changed.push('fewShots')
  }
  return { drift: changed.length > 0, changedFields: changed }
}
