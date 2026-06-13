import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import { detectImage } from '../../attachments/attachment-store.js'
import { CompatModelClient } from '../model/compat-model-client.js'
import type { ModelInputAttachment, ModelStreamChunk } from '../../ports/model-client.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'

export type ImageRecognitionDiagnostic = {
  id: 'imageRecognition'
  enabled: boolean
  available: boolean
  model?: string
  reason?: string
}

export type ImageRecognitionToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: ImageRecognitionDiagnostic[]
  available: boolean
  recognizer?: ImageRecognizer
}

export type RecognizeImageInput = {
  data: Buffer
  name: string
  mimeType?: string
  threadId: string
  turnId: string
  workspace: string
  signal: AbortSignal
  source?: string
  prompt?: string
}

export interface ImageRecognizer {
  recognize(input: RecognizeImageInput): Promise<ImageRecognitionResult>
}

export type ImageRecognitionResult = {
  text: string
  model: string
  mimeType: string
  width?: number
  height?: number
  source?: string
}

export function buildImageRecognitionToolProviders(
  config: KunCapabilitiesConfig['imageRecognition'] | undefined
): ImageRecognitionToolProviderBuildResult {
  if (!config?.enabled) return { providers: [], diagnostics: [], available: false }
  const missing = missingProviderFields(config)
  if (missing.length > 0) {
    const reason = `image recognition provider is not configured (missing ${missing.join(', ')})`
    return {
      providers: [{ id: 'imageRecognition', kind: 'image', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'imageRecognition', enabled: true, available: false, model: config.model, reason }],
      available: false
    }
  }

  const recognizer = new OpenAiImageRecognizer(config)
  const tool = LocalToolHost.defineTool({
    name: 'recognize_image',
    description: [
      'Recognize text and key details from an image at a local file path or URL using the configured multimodal fallback model.',
      'Relative local paths are resolved from the current workspace. URL inputs are downloaded locally first and fail if the download fails.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Local image path, workspace-relative image path, or http/https image URL.'
        },
        prompt: {
          type: 'string',
          description: 'Optional extra instruction appended after the configured image recognition prompt for this tool call.'
        }
      },
      required: ['source'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => withToolBoundary(async () => {
      const source = pickString(args.source)
      if (!source) return { output: { error: 'source is required' }, isError: true }
      const prompt = pickString(args.prompt)
      const image = await loadImageSource(source, context, config.maxDownloadBytes)
      const result = await recognizer.recognize({
        data: image.data,
        name: image.name,
        threadId: context.threadId,
        turnId: context.turnId,
        workspace: context.workspace,
        signal: context.abortSignal,
        source: image.source,
        ...(prompt ? { prompt } : {}),
        ...(image.mimeType ? { mimeType: image.mimeType } : {})
      })
      return {
        output: {
          text: result.text,
          model: result.model,
          image: {
            source: result.source,
            mimeType: result.mimeType,
            ...(result.width ? { width: result.width } : {}),
            ...(result.height ? { height: result.height } : {})
          }
        }
      }
    })
  })
  return {
    providers: [{ id: 'imageRecognition', kind: 'image', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'imageRecognition', enabled: true, available: true, model: config.model }],
    available: true,
    recognizer
  }
}

export class OpenAiImageRecognizer implements ImageRecognizer {
  constructor(private readonly config: KunCapabilitiesConfig['imageRecognition']) {}

  async recognize(input: RecognizeImageInput): Promise<ImageRecognitionResult> {
    const image = detectImage(input.data)
    if (!image) throw new Error('unsupported image MIME type')
    if (input.mimeType && input.mimeType !== image.mimeType) {
      throw new Error('declared MIME type does not match image content')
    }
    const client = new CompatModelClient({
      baseUrl: this.config.baseUrl!,
      apiKey: this.config.apiKey!,
      model: this.config.model!,
      nonStreaming: true
    })
    const attachment: ModelInputAttachment = {
      id: 'image_recognition_input',
      name: input.name,
      mimeType: image.mimeType,
      dataBase64: input.data.toString('base64'),
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {})
    }
    const chunks = client.stream({
      threadId: input.threadId,
      turnId: input.turnId,
      model: this.config.model!,
      prefix: [],
      history: [{
        id: `item_${input.turnId}_image_recognition`,
        threadId: input.threadId,
        turnId: input.turnId,
        role: 'user',
        status: 'completed',
        kind: 'user_message',
        text: buildRecognitionPrompt(this.config.prompt, input.prompt),
        createdAt: new Date().toISOString()
      }],
      attachments: [attachment],
      tools: [],
      stream: false,
      maxTokens: 1200,
      temperature: 0,
      abortSignal: timeoutSignal(input.signal, this.config.timeoutMs)
    })
    const text = await collectAssistantText(chunks)
    return {
      text,
      model: this.config.model!,
      mimeType: image.mimeType,
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
      ...(input.source ? { source: input.source } : {})
    }
  }
}

async function collectAssistantText(chunks: AsyncIterable<ModelStreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of chunks) {
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  const trimmed = text.trim()
  if (!trimmed) throw new Error('image recognition returned empty text')
  return trimmed
}

export function buildRecognitionPrompt(basePrompt: string, extraPrompt?: string): string {
  const base = basePrompt.trim()
  const extra = extraPrompt?.trim()
  if (!extra) return base
  const taggedExtra = [
    '<additional_instruction>',
    extra,
    '</additional_instruction>'
  ].join('\n')
  if (!base) return taggedExtra
  return `${base}\n\n${taggedExtra}`
}

async function loadImageSource(
  source: string,
  context: ToolHostContext,
  maxDownloadBytes: number
): Promise<{ data: Buffer; name: string; source: string; mimeType?: string }> {
  if (isHttpUrl(source)) return downloadImage(source, maxDownloadBytes, context.abortSignal)
  if (isAbsolute(source)) {
    const absolutePath = resolve(source)
    return {
      data: await readFile(absolutePath),
      name: basename(absolutePath) || 'image',
      source: absolutePath
    }
  }
  const resolved = resolveWorkspacePath(source, context)
  return {
    data: await readFile(resolved.absolutePath),
    name: basename(resolved.absolutePath) || 'image',
    source: resolved.absolutePath
  }
}

async function downloadImage(
  url: string,
  maxDownloadBytes: number,
  signal: AbortSignal
): Promise<{ data: Buffer; name: string; source: string; mimeType?: string }> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`image download failed: HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (contentLength > maxDownloadBytes) {
    throw new Error(`image download exceeds ${maxDownloadBytes} byte limit`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.byteLength > maxDownloadBytes) {
    throw new Error(`image download exceeds ${maxDownloadBytes} byte limit`)
  }
  const dir = await mkdtemp(join(tmpdir(), 'kun-image-recognition-'))
  const name = urlName(url)
  const localPath = join(dir, name)
  await writeFile(localPath, data)
  return {
    data,
    name,
    source: localPath,
    mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() || undefined
  }
}

function timeoutSignal(parent: AbortSignal, timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  if (parent.aborted) {
    controller.abort()
    return controller.signal
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  parent.addEventListener('abort', abort, { once: true })
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timer)
    parent.removeEventListener('abort', abort)
  }, { once: true })
  return controller.signal
}

function missingProviderFields(config: KunCapabilitiesConfig['imageRecognition']): string[] {
  const missing: string[] = []
  if (!config.baseUrl?.trim()) missing.push('baseUrl')
  if (!config.apiKey?.trim()) missing.push('apiKey')
  if (!config.model?.trim()) missing.push('model')
  return missing
}

function isHttpUrl(source: string): boolean {
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function urlName(source: string): string {
  try {
    const parsed = new URL(source)
    return basename(parsed.pathname) || 'downloaded-image'
  } catch {
    return 'downloaded-image'
  }
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
