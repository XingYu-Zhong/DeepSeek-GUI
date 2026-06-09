import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AttachmentsCapabilityConfig } from '../contracts/capabilities.js'
import type { AttachmentDiagnostics, AttachmentMetadata, AttachmentTextFallback } from '../contracts/attachments.js'
import { AttachmentMetadata as AttachmentMetadataSchema } from '../contracts/attachments.js'

export type AttachmentContent = AttachmentMetadata & {
  data: Buffer
}

export interface AttachmentStore {
  create(input: {
    name: string
    data: Buffer
    mimeType?: string
    textFallback?: AttachmentTextFallback
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata>
  get(id: string): Promise<AttachmentMetadata | null>
  resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent>
  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  >
  diagnostics(): Promise<AttachmentDiagnostics>
}

export class FileAttachmentStore implements AttachmentStore {
  constructor(
    private readonly options: {
      rootDir: string
      config: AttachmentsCapabilityConfig
      nowIso?: () => string
    }
  ) {}

  async create(input: {
    name: string
    data: Buffer
    mimeType?: string
    textFallback?: AttachmentTextFallback
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata> {
    await mkdir(this.options.rootDir, { recursive: true })
    const image = detectImage(input.data)
    if (!image) throw new Error('unsupported image MIME type')
    if (input.mimeType && input.mimeType !== image.mimeType) throw new Error('declared MIME type does not match image content')
    if (!this.options.config.allowedMimeTypes.includes(image.mimeType)) throw new Error(`image MIME type is not allowed: ${image.mimeType}`)
    if (input.data.byteLength > this.options.config.maxImageBytes) throw new Error(`image exceeds ${this.options.config.maxImageBytes} byte limit`)
    const maxDimension = Math.max(image.width ?? 0, image.height ?? 0)
    if (maxDimension > this.options.config.maxImageDimension) {
      throw new Error(`image exceeds ${this.options.config.maxImageDimension}px dimension limit`)
    }
    if (input.textFallback) validateTextFallback(input.textFallback, this.options.config)
    const hash = createHash('sha256').update(input.data).digest('hex')
    const id = `att_${hash.slice(0, 24)}`
    const contentPath = this.contentPath(id)
    const metadataPath = this.metadataPath(id)
    const now = this.options.nowIso?.() ?? new Date().toISOString()
    const existing = await this.get(id)
    if (existing) {
      const next = mergeScope({
        ...existing,
        ...(input.textFallback ? { textFallback: input.textFallback } : {}),
        updatedAt: now
      }, input)
      await writeFile(contentPath, input.data)
      await writeFile(metadataPath, JSON.stringify(next, null, 2), 'utf8')
      return next
    }
    const metadata: AttachmentMetadata = AttachmentMetadataSchema.parse(mergeScope({
      id,
      name: input.name,
      mimeType: image.mimeType,
      byteSize: input.data.byteLength,
      hash,
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
      ...(input.textFallback ? { textFallback: input.textFallback } : {}),
      threadIds: [],
      workspaces: [],
      createdAt: now,
      updatedAt: now
    }, input))
    await writeFile(contentPath, input.data)
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
    return metadata
  }

  async get(id: string): Promise<AttachmentMetadata | null> {
    try {
      return AttachmentMetadataSchema.parse(JSON.parse(await readFile(this.metadataPath(id), 'utf8')))
    } catch {
      return null
    }
  }

  async resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent> {
    const metadata = await this.get(id)
    if (!metadata) throw new Error(`attachment not found: ${id}`)
    if (!isAuthorized(metadata, scope)) throw new Error(`attachment is not authorized for this turn: ${id}`)
    return {
      ...metadata,
      data: await readFile(this.contentPath(id))
    }
  }

  async diagnostics(): Promise<AttachmentDiagnostics> {
    await mkdir(this.options.rootDir, { recursive: true })
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const metadata = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readFile(join(this.options.rootDir, entry), 'utf8')
          .then((text) => AttachmentMetadataSchema.parse(JSON.parse(text)))
          .catch(() => null))
    )
    const records = metadata.filter((record): record is AttachmentMetadata => Boolean(record))
    return {
      enabled: this.options.config.enabled,
      rootDir: this.options.rootDir,
      count: records.length,
      totalBytes: records.reduce((total, record) => total + record.byteSize, 0)
    }
  }

  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  > {
    return {
      textFallbackMaxBase64Bytes: this.options.config.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: this.options.config.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: this.options.config.textFallbackPreferredMimeType
    }
  }

  private contentPath(id: string): string {
    return join(this.options.rootDir, `${id}.bin`)
  }

  private metadataPath(id: string): string {
    return join(this.options.rootDir, `${id}.json`)
  }
}

function mergeScope<T extends AttachmentMetadata>(metadata: T, input: { threadId?: string; workspace?: string }): T {
  return {
    ...metadata,
    threadIds: mergeUnique(metadata.threadIds, input.threadId),
    workspaces: mergeUnique(metadata.workspaces, input.workspace)
  }
}

function mergeUnique(values: string[], value: string | undefined): string[] {
  return value && !values.includes(value) ? [...values, value] : values
}

function isAuthorized(metadata: AttachmentMetadata, scope: { threadId?: string; workspace?: string }): boolean {
  if (metadata.threadIds.length === 0 && metadata.workspaces.length === 0) return true
  if (scope.threadId && metadata.threadIds.includes(scope.threadId)) return true
  if (scope.workspace && metadata.workspaces.includes(scope.workspace)) return true
  return false
}

function validateTextFallback(fallback: AttachmentTextFallback, config: AttachmentsCapabilityConfig): void {
  if (!config.allowedMimeTypes.includes(fallback.mimeType)) {
    throw new Error(`fallback image MIME type is not allowed: ${fallback.mimeType}`)
  }
  if (Buffer.byteLength(fallback.dataBase64, 'utf8') > config.textFallbackMaxBase64Bytes) {
    throw new Error(`fallback image exceeds ${config.textFallbackMaxBase64Bytes} base64 byte limit`)
  }
  const maxDimension = Math.max(fallback.width ?? 0, fallback.height ?? 0)
  if (maxDimension > config.textFallbackMaxImageDimension) {
    throw new Error(`fallback image exceeds ${config.textFallbackMaxImageDimension}px dimension limit`)
  }
}

function detectImage(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' }
  }
  return null
}
