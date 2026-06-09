import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  arrayBufferToBase64,
  prepareImageAttachmentUpload,
  type EncodedAttachmentImage
} from './image-attachment-upload'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image attachment upload preparation', () => {
  it('reuses one bitmap decode for upload and text fallback preparation', async () => {
    const close = vi.fn()
    const createImageBitmap = vi.fn(async () => ({
      width: 10,
      height: 8,
      close
    }))
    const toBlob = vi.fn()
    const drawImage = vi.fn()
    const createElement = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob
    }))
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    vi.stubGlobal('document', { createElement })

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'shot.png', { type: 'image/png' })
    const prepared = await prepareImageAttachmentUpload(file, {
      maxImageBytes: 100,
      maxImageDimension: 100,
      textFallbackMaxBase64Bytes: 100,
      textFallbackMaxImageDimension: 100,
      textFallbackPreferredMimeType: 'image/webp'
    })

    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(createElement).not.toHaveBeenCalled()
    expect(toBlob).not.toHaveBeenCalled()
    expect(prepared).toMatchObject({
      dataBase64: 'AQIDBA==',
      mimeType: 'image/png',
      textFallback: {
        dataBase64: 'AQIDBA==',
        mimeType: 'image/png',
        byteSize: 4,
        width: 10,
        height: 8,
        wasCompressed: false
      }
    })
  })

  it('keeps custom encoders compatible by calling them for each variant', async () => {
    const encoded = (wasCompressed: boolean): EncodedAttachmentImage => ({
      dataBase64: wasCompressed ? 'ZmFsbGJhY2s=' : 'dXBsb2Fk',
      mimeType: 'image/webp',
      byteSize: wasCompressed ? 8 : 6,
      width: 4,
      height: 3,
      wasCompressed
    })
    const encoder = vi.fn(async (_file: File, options) =>
      encoded(Boolean(options.maxBase64Bytes))
    )
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

    const prepared = await prepareImageAttachmentUpload(file, {
      maxImageBytes: 100,
      maxImageDimension: 100,
      textFallbackMaxBase64Bytes: 64,
      textFallbackMaxImageDimension: 32,
      textFallbackPreferredMimeType: 'image/webp'
    }, encoder)

    expect(encoder).toHaveBeenCalledTimes(2)
    expect(encoder.mock.calls[0]?.[1]).toMatchObject({
      maxDecodedBytes: 100,
      maxDimension: 100
    })
    expect(encoder.mock.calls[1]?.[1]).toMatchObject({
      maxBase64Bytes: 64,
      maxDimension: 32
    })
    expect(prepared).toMatchObject({
      dataBase64: 'dXBsb2Fk',
      textFallback: {
        dataBase64: 'ZmFsbGJhY2s=',
        wasCompressed: true
      }
    })
  })

  it('rejects when no compressed text fallback can fit', async () => {
    const encoder = vi.fn(async (_file: File, options) => {
      if (options.maxBase64Bytes) return null
      return {
        dataBase64: 'dXBsb2Fk',
        mimeType: 'image/webp',
        byteSize: 6,
        width: 4,
        height: 3,
        wasCompressed: true
      }
    })
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

    await expect(prepareImageAttachmentUpload(file, {
      maxImageBytes: 100,
      maxImageDimension: 100,
      textFallbackMaxBase64Bytes: 4,
      textFallbackMaxImageDimension: 32,
      textFallbackPreferredMimeType: 'image/webp'
    }, encoder)).rejects.toThrow(/text fallback limits/)
  })

  it('encodes large array buffers without relying on one giant string conversion', () => {
    const bytes = new Uint8Array(100_000)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251

    const expected = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    expect(arrayBufferToBase64(bytes.buffer)).toBe(expected)
  })
})
