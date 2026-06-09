export const WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS = 300_000

export type WriteRenderNotice = 'none' | 'large-file' | 'truncated'

export type WriteRenderSafety = {
  livePreviewEnabled: boolean
  markdownPreviewEnabled: boolean
  readOnly: boolean
  notice: WriteRenderNotice
}

type WriteRenderSafetyOptions = {
  isMarkdown: boolean
  contentLength: number
  fileSize: number
  truncated: boolean
}

export function getWriteRenderSafety({
  isMarkdown,
  contentLength,
  fileSize,
  truncated
}: WriteRenderSafetyOptions): WriteRenderSafety {
  if (truncated) {
    return {
      livePreviewEnabled: false,
      markdownPreviewEnabled: false,
      readOnly: true,
      notice: 'truncated'
    }
  }

  if (!isMarkdown) {
    return {
      livePreviewEnabled: false,
      markdownPreviewEnabled: false,
      readOnly: false,
      notice: 'none'
    }
  }

  const documentSize = Math.max(0, contentLength, fileSize)
  if (documentSize > WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS) {
    return {
      livePreviewEnabled: false,
      markdownPreviewEnabled: false,
      readOnly: false,
      notice: 'large-file'
    }
  }

  return {
    livePreviewEnabled: true,
    markdownPreviewEnabled: true,
    readOnly: false,
    notice: 'none'
  }
}
