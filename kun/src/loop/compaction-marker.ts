import { createHash } from 'node:crypto'
import type { TurnItem } from '../contracts/items.js'

export function computeShortHash(content: string | Uint8Array, length = 16): string {
  return createHash('sha256').update(content).digest('hex').slice(0, Math.max(1, length))
}

export function createToolDigestMarker(shortHash: string): string {
  return `<kun:tool_digest sha256="${escapeMarkerAttribute(shortHash)}">`
}

export function compactedItemsDigestSource(items: readonly TurnItem[]): string {
  return stableStringify(items.map(compactionDigestShape))
}

function compactionDigestShape(item: TurnItem): unknown {
  switch (item.kind) {
    case 'user_message':
      return { kind: item.kind, text: item.text }
    case 'assistant_text':
      return { kind: item.kind, text: item.text }
    case 'assistant_reasoning':
      return { kind: item.kind, text: item.text }
    case 'tool_call':
      return {
        kind: item.kind,
        callId: item.callId,
        toolName: item.toolName,
        arguments: stableShape(item.arguments),
        summary: item.summary
      }
    case 'tool_result':
      return {
        kind: item.kind,
        callId: item.callId,
        toolName: item.toolName,
        output: stableShape(item.output),
        isError: item.isError
      }
    case 'approval':
      return {
        kind: item.kind,
        approvalId: item.approvalId,
        toolName: item.toolName,
        summary: item.summary,
        status: item.status
      }
    case 'user_input':
      return {
        kind: item.kind,
        inputId: item.inputId,
        prompt: item.prompt,
        status: item.status
      }
    case 'compaction':
      return {
        kind: item.kind,
        summary: item.summary,
        sourceDigest: item.sourceDigest,
        digestMarker: item.digestMarker,
        sourceItemIds: item.sourceItemIds,
        replacedTokens: item.replacedTokens
      }
    case 'error':
      return {
        kind: item.kind,
        message: item.message,
        code: item.code
      }
  }
}

function stableShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableShape)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = stableShape((value as Record<string, unknown>)[key])
  }
  return out
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableShape(value))
}

function escapeMarkerAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
