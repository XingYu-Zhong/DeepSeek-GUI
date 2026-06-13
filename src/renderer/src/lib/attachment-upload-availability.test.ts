import { describe, expect, it } from 'vitest'
import { isChatAttachmentUploadEnabled } from './attachment-upload-availability'

describe('isChatAttachmentUploadEnabled', () => {
  it('enables composer attachments in chat when the Kun attachment store is ready', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: true
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'plan',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: true
    })).toBe(true)
  })

  it('enables composer attachments in Write mode assistants when the selected model can read images', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'write',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: true
    })).toBe(true)
  })

  it('disables composer attachments outside ready supported modes', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'connecting',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: true
    })).toBe(false)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'settings',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: true
    })).toBe(false)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false
    })).toBe(false)
  })

  it('enables text-only composer attachments for new image recognition fallback sessions only', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: true,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      now: () => new Date('2026-06-13T08:00:01.000Z')
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: true,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      threadCreatedAt: '2026-06-13T08:00:01.000Z'
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: true,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      threadCreatedAt: '2026-06-13T07:59:59.000Z',
      now: () => new Date('2026-06-13T07:59:59.500Z')
    })).toBe(false)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: true,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      threadCreatedAt: '2026-06-13T07:59:59.000Z',
      now: () => new Date('2026-06-13T08:00:01.000Z')
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: true,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      threadCreatedAt: '2026-06-13T07:59:59.000Z',
      firstUserMessageCreatedAt: '2026-06-13T08:00:01.000Z'
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: true,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      threadCreatedAt: '2026-06-13T07:59:59.000Z',
      firstUserMessageCreatedAt: '2026-06-13T07:59:59.500Z'
    })).toBe(false)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true,
      modelSupportsImageInput: false,
      imageRecognitionAvailable: false,
      imageRecognitionEnabledAt: '2026-06-13T08:00:00.000Z',
      threadCreatedAt: '2026-06-13T08:00:01.000Z'
    })).toBe(false)
  })
})
