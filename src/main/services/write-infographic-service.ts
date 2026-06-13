import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { canonicalPath, normalizePathSeparators, resolveTargetPathWithinWorkspace } from './workspace-paths'
import {
  normalizeWriteSettings,
  resolveKunImageGenerationSettings,
  type AppSettingsV1,
  type KunImageGenerationSettingsV1,
  type WriteSettingsPatchV1
} from '../../shared/app-settings'
import {
  WRITE_DESIGN_DRAFT_DEFAULT_PROMPT,
  WRITE_INFOGRAPHIC_DEFAULT_PROMPT,
  WRITE_INFOGRAPHIC_MAX_TEXT_CHARS,
  type WriteInfographicKind,
  type WriteInfographicRequest,
  type WriteInfographicResult
} from '../../shared/write-infographic'
import {
  mapImageSize,
  createImageGenClient,
  ImageGenHttpError,
  type ImageGenClient
} from '../../../kun/src/adapters/tool/image-gen-tool-provider.js'
import { detectImage } from '../../../kun/src/attachments/attachment-store.js'

// Matches WORKSPACE_IMAGE_DIR in workspace-files.ts so infographics land in
// the same workspace-level folder as pasted images.
const INFOGRAPHIC_IMAGE_DIR = 'img'
const IMAGE_SIZE_TIER = '1K'
const MINIMAX_PROMPT_MAX_CHARS = 1_500
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
const REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
// Portrait reads best for infographics (768x1024); design mockups read best
// in landscape (1024x768). An explicit defaultSize setting overrides both.
const KIND_ASPECT_RATIO: Record<WriteInfographicKind, string> = {
  infographic: '3:4',
  design: '4:3'
}
const KIND_FILE_PREFIX: Record<WriteInfographicKind, string> = {
  infographic: 'infographic',
  design: 'design'
}
const KIND_DEFAULT_PROMPT: Record<WriteInfographicKind, string> = {
  infographic: WRITE_INFOGRAPHIC_DEFAULT_PROMPT,
  design: WRITE_DESIGN_DRAFT_DEFAULT_PROMPT
}

export function isWriteInfographicConfigured(
  imageGeneration: Pick<KunImageGenerationSettingsV1, 'enabled' | 'baseUrl' | 'apiKey' | 'model'>
): boolean {
  return (
    imageGeneration.enabled &&
    Boolean(imageGeneration.baseUrl.trim()) &&
    Boolean(imageGeneration.apiKey.trim()) &&
    Boolean(imageGeneration.model.trim())
  )
}

export function buildWriteInfographicPrompt(
  text: string,
  customPrompt = '',
  kind: WriteInfographicKind = 'infographic',
  options: { maxPromptChars?: number } = {}
): string {
  const clipped = text.trim().slice(0, WRITE_INFOGRAPHIC_MAX_TEXT_CHARS)
  const prefix = customPrompt.trim() || KIND_DEFAULT_PROMPT[kind]
  const maxPromptChars = options.maxPromptChars
  if (typeof maxPromptChars === 'number' && Number.isFinite(maxPromptChars) && maxPromptChars > 0) {
    return fitPromptToMaxChars(prefix, clipped, maxPromptChars)
  }
  return `${prefix}\n\n${clipped}`
}

function fitPromptToMaxChars(prefix: string, text: string, maxChars: number): string {
  const separator = '\n\n'
  const max = Math.max(1, Math.floor(maxChars))
  const fittedPrefix = prefix.slice(0, Math.max(0, max - separator.length)).trimEnd()
  const textBudget = Math.max(0, max - fittedPrefix.length - separator.length)
  const fittedText = text.slice(0, textBudget).trimEnd()
  return fittedText ? `${fittedPrefix}${separator}${fittedText}` : fittedPrefix
}

function imagePromptMaxChars(imageGeneration: KunImageGenerationSettingsV1): number | undefined {
  return imageGeneration.protocol === 'minimax-image' ? MINIMAX_PROMPT_MAX_CHARS : undefined
}

async function readReferenceImage(
  workspaceRoot: string,
  rawPath: string | undefined
): Promise<{ image?: { name: string; mimeType: string; data: Buffer }; error?: string }> {
  const input = rawPath?.trim()
  if (!input) return {}

  const absolutePath = isAbsolute(input) ? resolve(input) : resolve(workspaceRoot, input)
  const rel = relative(workspaceRoot, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return { error: 'reference image must be inside the write workspace' }
  }

  let data: Buffer
  try {
    data = await readFile(absolutePath)
  } catch {
    return { error: 'reference image not found' }
  }
  if (data.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    return { error: `reference image exceeds ${MAX_REFERENCE_IMAGE_BYTES} byte limit` }
  }
  const detected = detectImage(data)
  if (!detected || !REFERENCE_MIME_TYPES.has(detected.mimeType)) {
    return { error: 'reference image must be png, jpeg, or webp' }
  }
  return {
    image: {
      name: basename(absolutePath),
      mimeType: detected.mimeType,
      data
    }
  }
}

export async function requestWriteInfographic(
  settings: AppSettingsV1,
  request: WriteInfographicRequest,
  options: { client?: ImageGenClient } = {}
): Promise<WriteInfographicResult> {
  const imageGeneration = resolveKunImageGenerationSettings(settings)
  if (!isWriteInfographicConfigured(imageGeneration)) {
    return { ok: false, message: 'image generation provider is not configured' }
  }

  const text = request.text.trim()
  if (!text) return { ok: false, message: 'selection text is empty' }

  const workspaceRoot = resolve(request.workspaceRoot)
  const filePath = resolve(request.filePath)
  const relativeToRoot = relative(workspaceRoot, filePath)
  if (!relativeToRoot || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    return { ok: false, message: 'document must be inside the write workspace' }
  }

  const kind: WriteInfographicKind = request.kind ?? 'infographic'
  const client = options.client ?? createImageGenClient(imageGeneration)
  // An explicit defaultSize wins: users set it when their provider only
  // accepts fixed sizes (e.g. gpt-image's 1024x1536). Otherwise use an
  // aspect ratio that suits the image kind.
  const size = imageGeneration.defaultSize.trim() ||
    mapImageSize(KIND_ASPECT_RATIO[kind], IMAGE_SIZE_TIER, undefined)

  const selectionAssist = normalizeWriteSettings(
    (settings as { write?: WriteSettingsPatchV1 }).write
  ).selectionAssist
  const customPrompt = kind === 'design'
    ? selectionAssist.designDraftPrompt
    : selectionAssist.infographicPrompt
  const reference = await readReferenceImage(workspaceRoot, request.referenceImagePath)
  if (reference.error) return { ok: false, message: reference.error }

  let image: { data: Buffer; mimeType: string }
  try {
    const generationRequest = {
      prompt: buildWriteInfographicPrompt(text, customPrompt, kind, {
        maxPromptChars: imagePromptMaxChars(imageGeneration)
      }),
      model: imageGeneration.model.trim(),
      ...(size && size !== 'auto' ? { size } : {}),
      timeoutMs: imageGeneration.timeoutMs,
      signal: AbortSignal.timeout(imageGeneration.timeoutMs)
    }
    image = reference.image
      ? await client.edit({ ...generationRequest, images: [reference.image] })
      : await client.generate(generationRequest)
  } catch (error) {
    if (reference.image && error instanceof ImageGenHttpError && [404, 405, 501].includes(error.status)) {
      return {
        ok: false,
        message: 'the configured image provider does not support reference images'
      }
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  const ext = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const fileName = `${KIND_FILE_PREFIX[kind]}-${stamp}-${randomBytes(2).toString('hex')}.${ext}`
  let absolutePath: string
  let markdownPath: string
  try {
    const imageDirSetting = request.imageDir?.trim() || INFOGRAPHIC_IMAGE_DIR
    const imageDir = await resolveTargetPathWithinWorkspace(imageDirSetting, workspaceRoot)
    await mkdir(imageDir, { recursive: true })
    absolutePath = join(imageDir, fileName)
    await writeFile(absolutePath, image.data)
    // imageDir is canonicalized (symlinks resolved), so derive the document
    // directory from the same canonical root to keep the relative link clean.
    // dirname(imageDir) only equals the root for single-segment dirs, so
    // canonicalize the root itself (covers nested dirs like the per-
    // requirement '.kunsdd/requirements/<id>/img').
    const canonicalRoot = await canonicalPath(workspaceRoot)
    const documentDir = join(canonicalRoot, dirname(relativeToRoot))
    markdownPath = normalizePathSeparators(relative(documentDir, absolutePath))
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  return {
    ok: true,
    relativePath: markdownPath,
    absolutePath,
    fileName
  }
}
