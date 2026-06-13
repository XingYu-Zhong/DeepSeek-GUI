import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import { detectImage } from '../../attachments/attachment-store.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const GENERATED_IMAGE_DIR = '.deepseekgui-images'
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
const REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ASPECT_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
const SIZE_TIERS: Record<string, number> = { '1K': 1024, '2K': 2048 }
const SIZE_STEP = 64
const MIN_EDGE = 256

export type GeneratedImage = { data: Buffer; mimeType: string }

export type ImageGenRequest = {
  prompt: string
  model: string
  size?: string
  timeoutMs: number
  signal: AbortSignal
}

export type ImageGenEditRequest = ImageGenRequest & {
  images: { name: string; mimeType: string; data: Buffer }[]
}

export class ImageGenHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`HTTP ${status}: ${body}`)
  }
}

/**
 * Node's fetch reports every network failure as a bare `TypeError: fetch
 * failed`, hiding the actionable detail (DNS, refused connection, TLS, …)
 * in the `cause` chain. Flatten that chain into one readable message.
 */
export function describeNetworkError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      current = current.errors[0]
      continue
    }
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }
    const code = (current as { code?: unknown }).code
    const codeText = typeof code === 'string' ? code : ''
    const message = current.message.trim()
    if (message) {
      parts.push(codeText && !message.includes(codeText) ? `${message} (${codeText})` : message)
    } else if (codeText) {
      parts.push(codeText)
    }
    current = current.cause
  }
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return unique.join(': ') || 'unknown network error'
}

function imageFetchFailure(
  url: string,
  error: unknown,
  request: { timeoutMs: number }
): Error {
  const target = url.split('?')[0]
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`image request to ${target} timed out after ${request.timeoutMs}ms`, { cause: error })
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`image request to ${target} was canceled`, { cause: error })
  }
  return new Error(`image request to ${target} failed: ${describeNetworkError(error)}`, { cause: error })
}

export interface ImageGenClient {
  id: string
  generate(request: ImageGenRequest): Promise<GeneratedImage>
  edit(request: ImageGenEditRequest): Promise<GeneratedImage>
}

export type ImageGenDiagnostic = {
  id: 'imageGen'
  enabled: boolean
  available: boolean
  model?: string
  reason?: string
}

export type ImageGenToolProviderOptions = {
  client?: ImageGenClient
  attachmentStore?: AttachmentStore
  nowIso?: () => string
}

export type ImageGenToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: ImageGenDiagnostic[]
  available: boolean
}

/**
 * Map UI-friendly aspect ratio + size tier to an OpenAI-compatible "WxH"
 * size string. Long edge anchors to the tier (1K→1024, 2K→2048), short edge
 * follows the ratio snapped to multiples of 64 with a 256px floor. Both args
 * absent → fall back to the configured default (may be undefined or 'auto').
 */
export function mapImageSize(
  aspectRatio: string | undefined,
  imageSize: string | undefined,
  defaultSize: string | undefined
): string | undefined {
  if (!aspectRatio && !imageSize) return defaultSize
  const tier = SIZE_TIERS[imageSize ?? ''] ?? SIZE_TIERS['1K']
  const parsed = parseRatio(aspectRatio)
  if (!parsed) return `${tier}x${tier}`
  const { w, h } = parsed
  if (w === h) return `${tier}x${tier}`
  const short = Math.max(MIN_EDGE, Math.round((tier * Math.min(w, h)) / Math.max(w, h) / SIZE_STEP) * SIZE_STEP)
  return w > h ? `${tier}x${short}` : `${short}x${tier}`
}

function parseRatio(aspectRatio: string | undefined): { w: number; h: number } | null {
  if (!aspectRatio || !ASPECT_RATIOS.has(aspectRatio)) return null
  const [w, h] = aspectRatio.split(':').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

export function buildImageGenToolProviders(
  config: KunCapabilitiesConfig['imageGen'] | undefined,
  options: ImageGenToolProviderOptions = {}
): ImageGenToolProviderBuildResult {
  if (!config?.enabled) {
    return { providers: [], diagnostics: [], available: false }
  }

  const missing = [
    !config.baseUrl ? 'baseUrl' : undefined,
    !config.apiKey ? 'apiKey' : undefined,
    !config.model ? 'model' : undefined
  ].filter((field): field is string => Boolean(field))

  if (missing.length > 0) {
    const reason = `image generation provider is not configured (missing ${missing.join(', ')})`
    return {
      providers: [{ id: 'imageGen', kind: 'image', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'imageGen', enabled: true, available: false, model: config.model, reason }],
      available: false
    }
  }

  const client = options.client ?? createImageGenClient(config)
  const model = config.model!

  const tool = LocalToolHost.defineTool({
    name: 'generate_image',
    description: [
      'Generate an image from a text prompt using the configured image provider.',
      'Optionally pass reference_image_paths (image files inside the workspace) to guide the result (image-to-image).',
      `The generated image is saved under ${GENERATED_IMAGE_DIR}/ in the workspace and returned as an inline attachment preview.`,
      'Generates exactly one image per call; call again for variations.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image to generate' },
        aspect_ratio: { type: 'string', enum: [...ASPECT_RATIOS] },
        image_size: { type: 'string', enum: Object.keys(SIZE_TIERS), description: 'Resolution tier, defaults to 1K' },
        reference_image_paths: {
          type: 'array',
          items: { type: 'string' },
          maxItems: config.maxReferenceImages,
          description: 'Workspace-relative paths of reference images for image-to-image guidance'
        }
      },
      required: ['prompt'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const prompt = pickString(args.prompt)
      if (!prompt) return toolError('invalid_prompt', 'prompt is required')

      const aspectRatio = pickString(args.aspect_ratio)
      const imageSize = pickString(args.image_size)
      const size = mapImageSize(aspectRatio, imageSize, config.defaultSize)

      const references = await collectReferenceImages(
        args.reference_image_paths,
        context.workspace,
        config.maxReferenceImages
      )
      if ('error' in references) return references.error

      const endpoint = references.images.length > 0 ? 'edits' : 'generations'
      let image: GeneratedImage
      try {
        const request = {
          prompt,
          model,
          ...(size && size !== 'auto' ? { size } : {}),
          timeoutMs: config.timeoutMs,
          signal: context.abortSignal
        }
        image = endpoint === 'edits'
          ? await client.edit({ ...request, images: references.images })
          : await client.generate(request)
      } catch (error) {
        if (error instanceof ImageGenHttpError) {
          if (endpoint === 'edits' && (error.status === 404 || error.status === 405 || error.status === 501)) {
            return toolError(
              'edits_unsupported',
              'the configured image provider does not support reference images (/images/edits); retry generate_image without reference_image_paths'
            )
          }
          return toolError('provider_error', error.message, telemetry(startedAt, client.id))
        }
        return toolError('generation_failed', errorMessage(error), telemetry(startedAt, client.id))
      }

      const detected = detectImage(image.data)
      const mimeType = detected?.mimeType ?? image.mimeType ?? 'image/png'
      const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
      const stamp = (options.nowIso?.() ?? new Date().toISOString()).replace(/\D/g, '').slice(0, 14)
      const fileName = `img-${stamp}-${randomBytes(2).toString('hex')}.${ext}`
      // Forward slashes regardless of platform: the path is echoed back to the
      // model and rendered in chat, where POSIX-style relative paths are expected.
      const relativePath = `${GENERATED_IMAGE_DIR}/${fileName}`
      const absolutePath = join(context.workspace, GENERATED_IMAGE_DIR, fileName)
      await mkdir(join(context.workspace, GENERATED_IMAGE_DIR), { recursive: true })
      await writeFile(absolutePath, image.data)

      const warnings: string[] = []
      const attachments: { id: string; name: string; mimeType: string; width?: number; height?: number }[] = []
      if (options.attachmentStore) {
        try {
          const attachment = await options.attachmentStore.create({
            name: fileName,
            data: image.data,
            mimeType,
            threadId: context.threadId,
            workspace: context.workspace
          })
          attachments.push({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            ...(attachment.width ? { width: attachment.width } : {}),
            ...(attachment.height ? { height: attachment.height } : {})
          })
        } catch (error) {
          warnings.push(`inline preview unavailable: ${errorMessage(error)}`)
        }
      } else {
        warnings.push('inline preview unavailable: attachment store is disabled')
      }

      return {
        output: {
          files: [{
            relativePath,
            absolutePath,
            mimeType,
            byteSize: image.data.byteLength,
            ...(detected?.width ? { width: detected.width } : {}),
            ...(detected?.height ? { height: detected.height } : {})
          }],
          attachments,
          model,
          ...(size ? { size } : {}),
          endpoint,
          warnings,
          telemetry: telemetry(startedAt, client.id)
        }
      }
    }
  })

  return {
    providers: [{ id: 'imageGen', kind: 'image', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'imageGen', enabled: true, available: true, model }],
    available: true
  }
}

type ReferenceImages = { images: { name: string; mimeType: string; data: Buffer }[] }
type ReferenceError = { error: { output: unknown; isError: true } }

async function collectReferenceImages(
  value: unknown,
  workspace: string,
  maxCount: number
): Promise<ReferenceImages | ReferenceError> {
  if (value === undefined || value === null) return { images: [] }
  if (!Array.isArray(value)) {
    return { error: toolError('invalid_reference_path', 'reference_image_paths must be an array of strings') }
  }
  const paths = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  if (paths.length > maxCount) {
    return { error: toolError('invalid_reference_path', `at most ${maxCount} reference images are allowed`) }
  }
  const images: ReferenceImages['images'] = []
  for (const rawPath of paths) {
    const resolved = resolve(workspace, rawPath)
    const rel = relative(workspace, resolved)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { error: toolError('invalid_reference_path', `reference image must be inside the workspace: ${rawPath}`) }
    }
    let data: Buffer
    try {
      data = await readFile(resolved)
    } catch {
      return { error: toolError('invalid_reference_path', `reference image not found: ${rawPath}`) }
    }
    if (data.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
      return { error: toolError('invalid_reference_path', `reference image exceeds ${MAX_REFERENCE_IMAGE_BYTES} byte limit: ${rawPath}`) }
    }
    const detected = detectImage(data)
    if (!detected || !REFERENCE_MIME_TYPES.has(detected.mimeType)) {
      return { error: toolError('invalid_reference_path', `reference image must be png, jpeg, or webp: ${rawPath}`) }
    }
    images.push({ name: rawPath.split('/').pop() || 'reference.png', mimeType: detected.mimeType, data })
  }
  return { images }
}

type ImagesApiPayload = { data?: { b64_json?: string; url?: string }[] }
type MiniMaxImagePayload = {
  data?: {
    image_base64?: string[]
    image_urls?: string[]
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

export function createImageGenClient(config: {
  protocol?: string
  baseUrl?: string
  apiKey?: string
}): ImageGenClient {
  if (config.protocol === 'minimax-image') {
    return new MiniMaxImageClient(config.baseUrl!, config.apiKey!)
  }
  return new OpenAiCompatImageClient(config.baseUrl!, config.apiKey!)
}

/**
 * Endpoint URL for an OpenAI-compatible images API. Mirrors the chat
 * client's base-url rule so the same provider baseUrl works for both:
 * a versioned base (`…/v1`) gets the endpoint appended, anything else
 * gets `/v1` inserted first (e.g. `https://zenmux.ai/api` →
 * `…/api/v1/images/generations`). A fully-qualified endpoint URL is
 * kept, including re-routing between generations and edits.
 */
export function openAiCompatImageUrl(
  baseUrl: string,
  endpoint: 'generations' | 'edits'
): string {
  const path = `images/${endpoint}`
  let normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  const lower = normalized.toLowerCase()
  if (lower.endsWith(`/${path}`)) return normalized
  for (const known of ['images/generations', 'images/edits']) {
    if (lower.endsWith(`/${known}`)) {
      normalized = normalized.slice(0, -known.length).replace(/\/+$/, '')
      break
    }
  }
  const lastSegment = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (/^v\d+$/.test(lastSegment)) return `${normalized}/${path}`
  return `${normalized}/v1/${path}`
}

export class OpenAiCompatImageClient implements ImageGenClient {
  readonly id = 'openai-compat'
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    const body = (includeResponseFormat: boolean) =>
      JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        ...(request.size ? { size: request.size } : {}),
        ...(includeResponseFormat ? { response_format: 'b64_json' } : {})
      })
    return this.requestImage(
      openAiCompatImageUrl(this.baseUrl, 'generations'),
      (includeResponseFormat) => ({
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: body(includeResponseFormat)
      }),
      request
    )
  }

  async edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    const buildForm = (includeResponseFormat: boolean) => {
      const form = new FormData()
      form.set('model', request.model)
      form.set('prompt', request.prompt)
      if (request.size) form.set('size', request.size)
      if (includeResponseFormat) form.set('response_format', 'b64_json')
      const field = request.images.length > 1 ? 'image[]' : 'image'
      for (const image of request.images) {
        form.append(field, new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.name)
      }
      return form
    }
    return this.requestImage(
      openAiCompatImageUrl(this.baseUrl, 'edits'),
      (includeResponseFormat) => ({
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: buildForm(includeResponseFormat)
      }),
      request
    )
  }

  /**
   * POST with two compat fallbacks: providers that reject `response_format`
   * (e.g. gpt-image-1) get one retry without it, and providers that return a
   * URL instead of b64_json (e.g. SiliconFlow default) get a second download.
   */
  private async requestImage(
    url: string,
    init: (includeResponseFormat: boolean) => { headers: Record<string, string>; body: string | FormData },
    request: { timeoutMs: number; signal: AbortSignal }
  ): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    const post = async (includeResponseFormat: boolean): Promise<Response> => {
      try {
        return await fetch(url, { method: 'POST', ...init(includeResponseFormat), signal })
      } catch (error) {
        throw imageFetchFailure(url, error, request)
      }
    }
    let response = await post(true)
    if (!response.ok && response.status >= 400 && response.status < 500) {
      const errorBody = await response.text()
      if (!/response_format/i.test(errorBody)) throw new ImageGenHttpError(response.status, errorBody)
      response = await post(false)
    }
    if (!response.ok) {
      throw new ImageGenHttpError(response.status, await response.text())
    }
    const payload = (await response.json()) as ImagesApiPayload
    const entry = payload.data?.[0]
    if (entry?.b64_json) {
      return { data: Buffer.from(entry.b64_json, 'base64'), mimeType: 'image/png' }
    }
    if (entry?.url) {
      let download: Response
      try {
        download = await fetch(entry.url, { signal })
      } catch (error) {
        throw imageFetchFailure(entry.url, error, request)
      }
      if (!download.ok) throw new ImageGenHttpError(download.status, await download.text())
      const mimeType = download.headers.get('content-type')?.split(';')[0] || 'image/png'
      return { data: Buffer.from(await download.arrayBuffer()), mimeType }
    }
    throw new Error('image provider returned no image data')
  }
}

export class MiniMaxImageClient implements ImageGenClient {
  readonly id = 'minimax-image'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string
  ) {
    this.endpointUrl = minimaxImageGenerationUrl(baseUrl)
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    return this.requestImage({
      model: request.model,
      prompt: request.prompt,
      ...minimaxImageDimensionFields(request.model, request.size),
      prompt_optimizer: true,
      response_format: 'base64',
      n: 1
    }, request)
  }

  async edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    return this.requestImage({
      model: request.model,
      prompt: request.prompt,
      ...minimaxImageDimensionFields(request.model, request.size),
      subject_reference: request.images.map((image) => ({
        type: 'character',
        image_file: `data:${image.mimeType};base64,${image.data.toString('base64')}`
      })),
      prompt_optimizer: true,
      response_format: 'base64',
      n: 1
    }, request)
  }

  private async requestImage(
    body: Record<string, unknown>,
    request: { timeoutMs: number; signal: AbortSignal }
  ): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    let response: Response
    try {
      response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      throw imageFetchFailure(this.endpointUrl, error, request)
    }
    const text = await response.text()
    if (!response.ok) throw new ImageGenHttpError(response.status, text)
    let payload: MiniMaxImagePayload
    try {
      payload = JSON.parse(text) as MiniMaxImagePayload
    } catch {
      throw new Error('MiniMax image provider returned invalid JSON')
    }
    const statusCode = payload.base_resp?.status_code
    if (typeof statusCode === 'number' && statusCode !== 0) {
      throw new Error(`MiniMax image provider failed (${statusCode}): ${payload.base_resp?.status_msg ?? 'unknown error'}`)
    }
    const b64 = payload.data?.image_base64?.[0]
    if (b64) {
      return { data: Buffer.from(b64, 'base64'), mimeType: 'image/jpeg' }
    }
    const imageUrl = payload.data?.image_urls?.[0]
    if (imageUrl) {
      let download: Response
      try {
        download = await fetch(imageUrl, { signal })
      } catch (error) {
        throw imageFetchFailure(imageUrl, error, request)
      }
      if (!download.ok) throw new ImageGenHttpError(download.status, await download.text())
      const mimeType = download.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      return { data: Buffer.from(await download.arrayBuffer()), mimeType }
    }
    throw new Error('MiniMax image provider returned no image data')
  }
}

function minimaxImageGenerationUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const lower = normalized.toLowerCase()
  if (!normalized) return '/v1/image_generation'
  if (lower.endsWith('/v1/image_generation') || lower.endsWith('/image_generation')) return normalized
  if (lower.endsWith('/v1')) return `${normalized}/image_generation`
  return `${normalized}/v1/image_generation`
}

// aspect_ratio values both MiniMax image models accept (21:9 is image-01
// only, and image-01 receives explicit width/height instead).
const MINIMAX_ASPECT_RATIOS: Array<{ label: string; value: number }> = [
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 }
]

/**
 * MiniMax dimension fields for a `WxH` size. Per the t2i API docs only
 * image-01 accepts explicit width/height (range [512, 2048], multiples
 * of 8); image-01-live rejects them with status 2013, so every other model
 * gets the nearest supported aspect_ratio instead. Nearest (not exact)
 * because mapImageSize rounds edges to multiples of 8 — e.g. 3:2 at the 1K
 * tier becomes 1024x680.
 */
export function minimaxImageDimensionFields(
  model: string,
  size: string | undefined
): Record<string, unknown> {
  const match = size?.trim().match(/^(\d+)x(\d+)$/)
  if (!match) return {}
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {}
  if (model.trim() === 'image-01') return { width, height }
  const target = width / height
  let best = MINIMAX_ASPECT_RATIOS[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const candidate of MINIMAX_ASPECT_RATIOS) {
    const diff = Math.abs(Math.log(candidate.value / target))
    if (diff < bestDiff) {
      bestDiff = diff
      best = candidate
    }
  }
  return { aspect_ratio: best.label }
}

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

function telemetry(startedAt: number, provider: string): Record<string, unknown> {
  return { provider, durationMs: Date.now() - startedAt }
}

function toolError(code: string, message: string, toolTelemetry?: Record<string, unknown>): { output: unknown; isError: true } {
  return {
    output: {
      error: { code, message },
      ...(toolTelemetry ? { telemetry: toolTelemetry } : {})
    },
    isError: true
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
