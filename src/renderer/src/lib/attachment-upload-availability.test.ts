import { describe, expect, it } from 'vitest'
import { isChatAttachmentUploadEnabled } from './attachment-upload-availability'

describe('isChatAttachmentUploadEnabled', () => {
  it('enables composer attachments in chat when the Kun attachment store is ready', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'plan',
      attachmentStoreAvailable: true
    })).toBe(true)
  })

  it('disables composer attachments outside ready chat mode', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'connecting',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(false)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'write',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(false)
  })
})
