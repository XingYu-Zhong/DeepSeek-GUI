export type ToolArgumentRepairResult = {
  arguments: Record<string, unknown>
  repaired: boolean
}

export function repairToolArguments(raw: string): ToolArgumentRepairResult {
  const trimmed = raw.trim()
  if (!trimmed) return { arguments: {}, repaired: false }
  const direct = parseObject(trimmed)
  if (direct) return { arguments: direct, repaired: false }

  const candidates = [
    stripMarkdownFence(trimmed),
    extractFirstJsonObject(trimmed),
    extractFirstJsonArray(trimmed)
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()))

  for (const candidate of candidates) {
    const parsed = parseAny(candidate)
    if (parsed.ok) {
      return {
        arguments: valueToArguments(parsed.value),
        repaired: true
      }
    }
  }

  return {
    arguments: { __raw: raw },
    repaired: false
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  const parsed = parseAny(text)
  if (!parsed.ok) return null
  if (parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
    return parsed.value as Record<string, unknown>
  }
  return null
}

function parseAny(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function valueToArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function stripMarkdownFence(text: string): string {
  const fence = /^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return fence?.[1]?.trim() ?? text
}

function extractFirstJsonObject(text: string): string | null {
  return extractBalanced(text, '{', '}')
}

function extractFirstJsonArray(text: string): string | null {
  return extractBalanced(text, '[', ']')
}

function extractBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === open) depth += 1
    if (char === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}
