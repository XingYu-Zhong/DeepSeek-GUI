import { isSddImageRelativePath, isSddPrototypeRelativePath, normalizeSddRelativePath } from '@shared/sdd'

export type SddDraftImageReference = {
  index: number
  alt: string
  markdownPath: string
  relativePath: string
  mimeType: string
  dataBase64: string
  byteSize: number
  width?: number
  height?: number
  attachmentId?: string
}

export type SddDraftImageCollection = {
  images: SddDraftImageReference[]
  errors: string[]
}

type ParsedMarkdownImage = {
  alt: string
  markdownPath: string
}

type WorkspaceImageReader = (input: {
  workspaceRoot: string
  path: string
}) => Promise<
  | { ok: true; path: string; dataUrl: string; mimeType: string; size: number }
  | { ok: false; message: string }
>

type ImageMeasurer = (dataUrl: string) => Promise<{ width?: number; height?: number }>

const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

function isExternalImagePath(value: string): boolean {
  return /^(?:https?:|data:|mailto:|#)/i.test(value.trim())
}

function parseMarkdownDestination(raw: string): string {
  const trimmed = raw.trim()
  const unwrapped = trimmed.startsWith('<') && trimmed.includes('>')
    ? trimmed.slice(1, trimmed.indexOf('>'))
    : trimmed
  const quoteIndex = unwrapped.search(/\s+["']/)
  return (quoteIndex >= 0 ? unwrapped.slice(0, quoteIndex) : unwrapped).trim()
}

export function parseSddMarkdownImages(markdown: string): ParsedMarkdownImage[] {
  const out: ParsedMarkdownImage[] = []
  for (const match of markdown.matchAll(IMAGE_MARKDOWN_RE)) {
    const markdownPath = parseMarkdownDestination(match[2] ?? '')
    if (!markdownPath || isExternalImagePath(markdownPath)) continue
    out.push({
      alt: (match[1] ?? '').replaceAll('\\]', ']').trim(),
      markdownPath
    })
  }
  return out
}

function dirname(path: string): string {
  const normalized = normalizeSddRelativePath(path)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function normalizeRelativeParts(parts: string[]): string | null {
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

export function resolveSddMarkdownImagePath(
  draftRelativePath: string,
  markdownPath: string
): string | null {
  const raw = markdownPath.trim().replaceAll('\\', '/')
  if (!raw || raw.startsWith('/')) return null
  const direct = normalizeSddRelativePath(raw)
  if (direct.startsWith('.kunsdd/')) return normalizeRelativeParts(direct.split('/'))
  return normalizeRelativeParts([...dirname(draftRelativePath).split('/'), ...raw.split('/')])
}

function parseDataUrl(dataUrl: string): { mimeType: string; dataBase64: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/)
  if (!match) return null
  return {
    mimeType: match[1]!,
    dataBase64: match[2]!
  }
}

export async function measureImageDataUrl(dataUrl: string): Promise<{ width?: number; height?: number }> {
  if (typeof Image === 'undefined') return {}
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({})
    image.src = dataUrl
  })
}

export async function collectSddDraftImages(input: {
  markdown: string
  draftRelativePath: string
  workspaceRoot: string
  readImage?: WorkspaceImageReader
  measureImage?: ImageMeasurer
}): Promise<SddDraftImageCollection> {
  const readImage = input.readImage ?? window.kunGui.readWorkspaceImage
  const measureImage = input.measureImage ?? measureImageDataUrl
  const errors: string[] = []
  const images: SddDraftImageReference[] = []
  const seen = new Set<string>()

  for (const parsed of parseSddMarkdownImages(input.markdown)) {
    const relativePath = resolveSddMarkdownImagePath(input.draftRelativePath, parsed.markdownPath)
    if (!relativePath) {
      errors.push(`Image path is outside the workspace: ${parsed.markdownPath}`)
      continue
    }
    const normalizedPath = normalizeSddRelativePath(relativePath)
    // Interactive prototypes are embedded with image syntax but are HTML
    // documents, not images: leave the link in the markdown (the build agent
    // can open the file) and never read it as an image.
    if (isSddPrototypeRelativePath(normalizedPath)) continue
    if (!isSddImageRelativePath(normalizedPath)) {
      errors.push(`SDD images must live in the requirement's img directory: ${parsed.markdownPath}`)
      continue
    }
    if (seen.has(normalizedPath)) continue
    seen.add(normalizedPath)

    const result = await readImage({
      workspaceRoot: input.workspaceRoot,
      path: normalizedPath
    })
    if (!result.ok) {
      errors.push(`Failed to read ${parsed.markdownPath}: ${result.message}`)
      continue
    }
    const encoded = parseDataUrl(result.dataUrl)
    if (!encoded) {
      errors.push(`Failed to encode ${parsed.markdownPath} as base64.`)
      continue
    }
    const dimensions = await measureImage(result.dataUrl)
    images.push({
      index: images.length + 1,
      alt: parsed.alt,
      markdownPath: parsed.markdownPath,
      relativePath: normalizedPath,
      mimeType: encoded.mimeType || result.mimeType,
      dataBase64: encoded.dataBase64,
      byteSize: result.size,
      ...(dimensions.width ? { width: dimensions.width } : {}),
      ...(dimensions.height ? { height: dimensions.height } : {})
    })
  }

  return { images, errors }
}

export function withAttachmentIds(
  images: SddDraftImageReference[],
  attachmentIds: string[]
): SddDraftImageReference[] {
  return images.map((image, index) => ({
    ...image,
    ...(attachmentIds[index] ? { attachmentId: attachmentIds[index] } : {})
  }))
}
