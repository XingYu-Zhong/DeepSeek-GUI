import type { ChatBlock } from '../agent/types'
import { normalizeDevPreviewUrlInput } from '@shared/dev-preview-url'

const MAX_DETECTED_URLS = 4
const NEARBY_URL_CONTEXT_CHARS = 120
const LOCAL_URL_CANDIDATE_RE =
  /\b(?:https?:\/\/)?(?:localhost|(?:[\w-]+\.)?localhost|host\.docker\.internal|[\w.-]+\.local|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])(?::\d{2,5})?(?:\/[^\s'"<>)\]]*)?/gi
const DEV_SERVER_COMMAND_RE =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)|vite(?:\s|$)|next\s+dev|nuxt\s+dev|astro\s+dev|remix\s+dev|webpack(?:-dev-server|\s+serve)|react-scripts\s+start|storybook(?:\s+dev)?|svelte-kit\s+dev)\b/i
const DEV_SERVER_OUTPUT_RE =
  /\b(?:vite v?\d|local:\s*https?:\/\/|network:\s*https?:\/\/|ready in \d+(?:\.\d+)?\s*(?:ms|s)|ready on\s+https?:\/\/|started server|server started|compiled successfully|webpack compiled|app running at|serving at|listening on\s+https?:\/\/)\b/i
const DEV_PREVIEW_ASSISTANT_ACTION_RE =
  /\b(?:open|visit|browse|view|check(?:\s+it)?\s+out|go\s+to)\b|(?:打开|访问|前往|查看)/i
const DEV_PREVIEW_ASSISTANT_STATUS_RE =
  /\b(?:served|serving|running|started|available|reachable|live\s+at|running\s+at|available\s+at|listening\s+on|app\s+running\s+at|serving\s+at)\b|(?:运行在|启动于|已启动|可访问|可预览|本地服务)/i
const NON_PREVIEW_CONTEXT_RE =
  /\b(?:deepseek(?:-tui)?|runtime|runtime:request|health check|bearer token|sse|threads?)\b|\/(?:health|v\d+\/|metrics|readyz?|livez?)(?:\b|\/|\?)/i

type DevPreviewExtractionMode = 'card' | 'auto_open'

function textFromBlock(block: ChatBlock): string {
  if (block.kind === 'tool') {
    let meta = ''
    try {
      meta = block.meta ? JSON.stringify(block.meta) : ''
    } catch {
      meta = ''
    }
    return [block.summary, block.detail, meta].filter(Boolean).join('\n')
  }
  if (block.kind === 'approval' || block.kind === 'user_input') return ''
  return 'text' in block ? block.text : ''
}

function trimUrlCandidate(candidate: string): string {
  return candidate.replace(/[`),.;]+$/g, '')
}

function surroundingUrlContext(text: string, matchIndex: number, matchLength: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, matchIndex - 1))
  const lineEnd = text.indexOf('\n', matchIndex + matchLength)
  const nearestLine = text.slice(lineStart === -1 ? 0 : lineStart + 1, lineEnd === -1 ? text.length : lineEnd)
  if (nearestLine.length <= NEARBY_URL_CONTEXT_CHARS * 2) return nearestLine

  const start = Math.max(0, matchIndex - NEARBY_URL_CONTEXT_CHARS)
  const end = Math.min(text.length, matchIndex + matchLength + NEARBY_URL_CONTEXT_CHARS)
  return text.slice(start, end)
}

function commandTextFromBlock(block: ChatBlock): string {
  if (block.kind !== 'tool' || !block.meta) return ''
  const command = block.meta.command
  if (Array.isArray(command)) return command.map(String).join(' ')
  if (typeof command === 'string') return command
  return ''
}

function assistantContextCanShowPreview(text: string): boolean {
  return (
    DEV_PREVIEW_ASSISTANT_ACTION_RE.test(text) || DEV_PREVIEW_ASSISTANT_STATUS_RE.test(text)
  )
}

function assistantUrlCanShowPreview(
  text: string,
  matchIndex: number,
  matchLength: number,
  outputLooksLikeDevServer: boolean
): boolean {
  if (outputLooksLikeDevServer) return true
  const context = surroundingUrlContext(text, matchIndex, matchLength)
  if (NON_PREVIEW_CONTEXT_RE.test(context)) return false
  return assistantContextCanShowPreview(context)
}

function blockCanAdvertiseDevPreview(
  block: ChatBlock,
  text: string,
  mode: DevPreviewExtractionMode
): boolean {
  if (block.kind === 'assistant') {
    const outputLooksLikeDevServer = DEV_SERVER_OUTPUT_RE.test(text)
    if (mode === 'auto_open') return outputLooksLikeDevServer
    if (outputLooksLikeDevServer) return true
    if (NON_PREVIEW_CONTEXT_RE.test(text)) return false
    return assistantContextCanShowPreview(text)
  }

  if (block.kind !== 'tool') return false
  if (block.toolKind && block.toolKind !== 'command_execution') return false

  const commandText = commandTextFromBlock(block)
  const commandLooksLikeDevServer = DEV_SERVER_COMMAND_RE.test(commandText)
  const outputLooksLikeDevServer = DEV_SERVER_OUTPUT_RE.test(text)

  if (!commandLooksLikeDevServer && !outputLooksLikeDevServer) return false
  if (block.status === 'error' && !outputLooksLikeDevServer) return false
  if (NON_PREVIEW_CONTEXT_RE.test(text) && !outputLooksLikeDevServer && !commandLooksLikeDevServer) {
    return false
  }
  return true
}

function urlLooksLikePagePreview(url: string): boolean {
  try {
    const parsed = new URL(url)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    if (/^\/(?:health|metrics|readyz?|livez?|v\d+)(?:\/|$)/.test(pathname)) return false
    if (/\/(?:health|metrics|readyz?|livez?)(?:\/|$)/.test(pathname)) return false
    return true
  } catch {
    return false
  }
}

function collectDetectedDevPreviewUrls(
  blocks: ChatBlock[],
  mode: DevPreviewExtractionMode
): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]!
    const text = textFromBlock(block)
    if (!blockCanAdvertiseDevPreview(block, text, mode)) continue
    const outputLooksLikeDevServer = DEV_SERVER_OUTPUT_RE.test(text)

    for (const match of text.matchAll(LOCAL_URL_CANDIDATE_RE)) {
      if (
        block.kind === 'assistant' &&
        !assistantUrlCanShowPreview(text, match.index ?? 0, match[0].length, outputLooksLikeDevServer)
      ) {
        continue
      }
      const normalized = normalizeDevPreviewUrlInput(trimUrlCandidate(match[0]))
      if (!normalized || !urlLooksLikePagePreview(normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(normalized)
      if (urls.length >= MAX_DETECTED_URLS) return urls
    }
  }

  return urls
}

export function extractDetectedDevPreviewUrls(blocks: ChatBlock[]): string[] {
  return collectDetectedDevPreviewUrls(blocks, 'card')
}

export function extractAutoOpenDevPreviewUrls(blocks: ChatBlock[]): string[] {
  return collectDetectedDevPreviewUrls(blocks, 'auto_open')
}

export function extractLatestTurnDevPreviewUrls(blocks: ChatBlock[]): string[] {
  let latestUserIndex = -1
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.kind === 'user') {
      latestUserIndex = i
      break
    }
  }
  if (latestUserIndex === -1) return []
  return extractDetectedDevPreviewUrls(blocks.slice(latestUserIndex + 1))
}

export function extractLatestTurnAutoOpenDevPreviewUrls(blocks: ChatBlock[]): string[] {
  let latestUserIndex = -1
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.kind === 'user') {
      latestUserIndex = i
      break
    }
  }
  if (latestUserIndex === -1) return []
  return extractAutoOpenDevPreviewUrls(blocks.slice(latestUserIndex + 1))
}

export function formatDevPreviewUrlLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return url
  }
}
