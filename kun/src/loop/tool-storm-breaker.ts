import type { ToolCallLike } from '../ports/tool-host.js'

export type ToolStormBreakerOptions = {
  windowSize?: number
  threshold?: number
}

type RecentToolCall = {
  name: string
  args: string
  readOnly: boolean
}

const DEFAULT_WINDOW_SIZE = 8
const DEFAULT_THRESHOLD = 3
const MUTATING_TOOL_NAMES = new Set(['write', 'edit', 'edit_diff', 'apply_patch', 'delete', 'move'])
const STORM_EXEMPT_TOOL_NAMES = new Set(['request_user_input', 'user_input'])

/**
 * Prevents repeated identical tool calls from inflating dynamic history
 * and cache misses. It is deliberately turn-scoped; a new user turn is
 * a new intent, so the AgentLoop resets the breaker between turns.
 */
export class ToolStormBreaker {
  private readonly windowSize: number
  private readonly threshold: number
  private readonly recent: RecentToolCall[] = []

  constructor(options: ToolStormBreakerOptions = {}) {
    this.windowSize = Math.max(1, Math.floor(options.windowSize ?? DEFAULT_WINDOW_SIZE))
    this.threshold = Math.max(2, Math.floor(options.threshold ?? DEFAULT_THRESHOLD))
  }

  inspect(call: ToolCallLike): { suppress: boolean; reason?: string } {
    if (STORM_EXEMPT_TOOL_NAMES.has(call.toolName)) return { suppress: false }
    const name = call.toolName
    const args = stableStringify(call.arguments)
    const readOnly = !isMutatingToolCall(call)

    if (!readOnly) {
      this.clearReadOnlyEntries()
    }

    const count = this.recent.reduce(
      (sum, entry) => sum + (entry.name === name && entry.args === args ? 1 : 0),
      0
    )
    if (count >= this.threshold - 1) {
      return {
        suppress: true,
        reason:
          `${name} was called with identical arguments ${count + 1} times in this turn; ` +
          'repeat-loop guard suppressed the duplicate. Choose a narrower query or explain why another identical call is needed.'
      }
    }

    this.recent.push({ name, args, readOnly })
    while (this.recent.length > this.windowSize) this.recent.shift()
    return { suppress: false }
  }

  reset(): void {
    this.recent.length = 0
  }

  private clearReadOnlyEntries(): void {
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      if (this.recent[index]?.readOnly) this.recent.splice(index, 1)
    }
  }
}

function isMutatingToolCall(call: ToolCallLike): boolean {
  if (call.toolKind === 'file_change') return true
  return MUTATING_TOOL_NAMES.has(call.toolName)
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value))
  } catch {
    return String(value)
  }
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
