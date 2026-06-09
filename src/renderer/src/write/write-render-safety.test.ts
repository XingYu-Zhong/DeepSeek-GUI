import { describe, expect, it } from 'vitest'
import {
  getWriteRenderSafety,
  WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS
} from './write-render-safety'

describe('write render safety', () => {
  it('keeps small markdown files fully interactive', () => {
    expect(getWriteRenderSafety({
      isMarkdown: true,
      contentLength: 12_000,
      fileSize: 12_000,
      truncated: false
    })).toEqual({
      livePreviewEnabled: true,
      markdownPreviewEnabled: true,
      readOnly: false,
      notice: 'none'
    })
  })

  it('disables heavy markdown rendering for large files', () => {
    expect(getWriteRenderSafety({
      isMarkdown: true,
      contentLength: WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS + 1,
      fileSize: WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS + 1,
      truncated: false
    })).toEqual({
      livePreviewEnabled: false,
      markdownPreviewEnabled: false,
      readOnly: false,
      notice: 'large-file'
    })
  })

  it('opens truncated files in read-only safety mode', () => {
    expect(getWriteRenderSafety({
      isMarkdown: true,
      contentLength: 180_000,
      fileSize: 1_500_000,
      truncated: true
    })).toEqual({
      livePreviewEnabled: false,
      markdownPreviewEnabled: false,
      readOnly: true,
      notice: 'truncated'
    })
  })

  it('keeps plain text files out of markdown rendering without forcing read-only', () => {
    expect(getWriteRenderSafety({
      isMarkdown: false,
      contentLength: WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS + 50_000,
      fileSize: WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS + 50_000,
      truncated: false
    })).toEqual({
      livePreviewEnabled: false,
      markdownPreviewEnabled: false,
      readOnly: false,
      notice: 'none'
    })
  })
})
