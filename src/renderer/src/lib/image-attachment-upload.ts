import type { CoreAttachmentTextFallbackJson } from '../agent/kun-contract'

export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES = 512 * 1024
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION = 1280
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE = 'image/webp'

export type ImageAttachmentUploadCapabilities = {
  maxImageBytes: number
  maxImageDimension: number
  allowedMimeTypes?: string[]
  textFallbackMaxBase64Bytes?: number
  textFallbackMaxImageDimension?: number
  textFallbackPreferredMimeType?: string
}

export type EncodedAttachmentImage = {
  dataBase64: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  wasCompressed: boolean
}

export type ImageAttachmentEncoderOptions = {
  maxDecodedBytes?: number
  maxBase64Bytes?: number
  maxDimension: number
  preferredMimeType: string
  allowedMimeTypes?: string[]
}

export type ImageAttachmentEncoder = (
  file: File,
  options: ImageAttachmentEncoderOptions
) => Promise<EncodedAttachmentImage | null>

export type PreparedImageAttachmentUpload = {
  dataBase64: string
  mimeType: string
  textFallback: CoreAttachmentTextFallbackJson
}

export async function prepareImageAttachmentUpload(
  file: File,
  capabilities: ImageAttachmentUploadCapabilities,
  encoder: ImageAttachmentEncoder = encodeImageWithCanvas
): Promise<PreparedImageAttachmentUpload> {
  const preferredMimeType = resolvePreferredMimeType(capabilities)
  const uploadOptions: ImageAttachmentEncoderOptions = {
    maxDecodedBytes: capabilities.maxImageBytes,
    maxDimension: capabilities.maxImageDimension,
    preferredMimeType,
    allowedMimeTypes: capabilities.allowedMimeTypes
  }
  const textFallbackOptions: ImageAttachmentEncoderOptions = {
    maxBase64Bytes:
      capabilities.textFallbackMaxBase64Bytes ?? DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES,
    maxDimension:
      capabilities.textFallbackMaxImageDimension ?? DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION,
    preferredMimeType,
    allowedMimeTypes: capabilities.allowedMimeTypes
  }
  const [uploadImage, textFallback] =
    encoder === encodeImageWithCanvas
      ? await encodeImageVariantsWithCanvas(file, [uploadOptions, textFallbackOptions])
      : [
          await encoder(file, uploadOptions),
          await encoder(file, textFallbackOptions)
        ]
  if (!uploadImage) {
    throw new Error('Image could not be compressed within the upload limits.')
  }
  if (!textFallback) {
    throw new Error('Image could not be compressed within the text fallback limits.')
  }

  return {
    dataBase64: uploadImage.dataBase64,
    mimeType: uploadImage.mimeType,
    textFallback: {
      dataBase64: textFallback.dataBase64,
      mimeType: textFallback.mimeType,
      byteSize: textFallback.byteSize,
      width: textFallback.width,
      height: textFallback.height,
      wasCompressed: textFallback.wasCompressed
    }
  }
}

export async function encodeImageWithCanvas(
  file: File,
  options: ImageAttachmentEncoderOptions
): Promise<EncodedAttachmentImage | null> {
  const [encoded] = await encodeImageVariantsWithCanvas(file, [options])
  return encoded ?? null
}

export async function encodeImageVariantsWithCanvas(
  file: File,
  variants: readonly ImageAttachmentEncoderOptions[]
): Promise<Array<EncodedAttachmentImage | null>> {
  if (variants.length === 0) return []
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return variants.map(() => null)
  }
  const bitmap = await createImageBitmap(file)
  try {
    const originalBuffer = await file.arrayBuffer()
    const originalBase64 = arrayBufferToBase64(originalBuffer)
    const cache = new Map<string, EncodedAttachmentImage | null>()
    const out: Array<EncodedAttachmentImage | null> = []
    for (const options of variants) {
      const key = encoderOptionsKey(options)
      if (!cache.has(key)) {
        cache.set(key, await encodeImageWithBitmap(file, bitmap, originalBase64, options))
      }
      out.push(cache.get(key) ?? null)
    }
    return out
  } finally {
    bitmap.close()
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join(''))
}

async function encodeImageWithBitmap(
  file: File,
  bitmap: ImageBitmap,
  originalBase64: string,
  options: ImageAttachmentEncoderOptions
): Promise<EncodedAttachmentImage | null> {
  const sourceMimeType = file.type || options.preferredMimeType
    if (imageFitsLimits({
      base64: originalBase64,
      byteSize: file.size,
      mimeType: sourceMimeType,
      width: bitmap.width,
      height: bitmap.height,
      options
  })) {
    return {
      dataBase64: originalBase64,
      mimeType: sourceMimeType,
      byteSize: file.size,
      width: bitmap.width,
      height: bitmap.height,
      wasCompressed: false
    }
  }

  const largest = Math.max(bitmap.width, bitmap.height)
  let currentMax = Math.max(1, Math.min(options.maxDimension, largest))
  while (currentMax >= 1) {
    const scale = Math.min(1, currentMax / largest)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)

    for (const quality of [0.86, 0.72, 0.58, 0.44, 0.32]) {
      const blob = await canvasToBlob(canvas, options.preferredMimeType, quality)
      if (!blob) continue
      const dataBase64 = arrayBufferToBase64(await blob.arrayBuffer())
        if (imageFitsLimits({
          base64: dataBase64,
          byteSize: blob.size,
          mimeType: blob.type || options.preferredMimeType,
          width,
          height,
          options
      })) {
        return {
          dataBase64,
          mimeType: blob.type || options.preferredMimeType,
          byteSize: blob.size,
          width,
          height,
          wasCompressed: true
        }
      }
    }

    const nextMax = Math.floor(currentMax * 0.75)
    currentMax = nextMax < currentMax ? nextMax : currentMax - 1
  }
  return null
}

function encoderOptionsKey(options: ImageAttachmentEncoderOptions): string {
  return JSON.stringify({
    maxDecodedBytes: options.maxDecodedBytes,
    maxBase64Bytes: options.maxBase64Bytes,
    maxDimension: options.maxDimension,
    preferredMimeType: options.preferredMimeType,
    allowedMimeTypes: options.allowedMimeTypes
  })
}

function resolvePreferredMimeType(capabilities: ImageAttachmentUploadCapabilities): string {
  const preferred =
    capabilities.textFallbackPreferredMimeType || DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE
  if (!capabilities.allowedMimeTypes?.length) return preferred
  return capabilities.allowedMimeTypes.includes(preferred)
    ? preferred
    : capabilities.allowedMimeTypes[0]!
}

function imageFitsLimits(input: {
  base64: string
  byteSize: number
  mimeType: string
  width: number
  height: number
  options: ImageAttachmentEncoderOptions
}): boolean {
  if (input.options.allowedMimeTypes?.length && !input.options.allowedMimeTypes.includes(input.mimeType)) return false
  if (Math.max(input.width, input.height) > input.options.maxDimension) return false
  if (input.options.maxDecodedBytes !== undefined && input.byteSize > input.options.maxDecodedBytes) return false
  if (
    input.options.maxBase64Bytes !== undefined &&
    base64ByteLength(input.base64) > input.options.maxBase64Bytes
  ) return false
  return true
}

function base64ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality)
    } catch {
      resolve(null)
    }
  })
}
