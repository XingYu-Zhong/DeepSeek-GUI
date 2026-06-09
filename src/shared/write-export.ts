export const WRITE_EXPORT_FORMATS = ['html', 'pdf', 'doc', 'docx'] as const

export type WriteExportFormat = (typeof WRITE_EXPORT_FORMATS)[number]

export type WriteExportPayload = {
  path: string
  workspaceRoot?: string
  format: WriteExportFormat
  content: string
}

export type WriteRichClipboardPayload = {
  path: string
  workspaceRoot?: string
  content: string
}

export type WriteExportResult =
  | {
      ok: true
      path: string
      format: WriteExportFormat
      exportedAt: string
    }
  | {
      ok: false
      canceled: true
      message?: string
    }
  | {
      ok: false
      canceled: false
      message: string
    }

export type WriteRichClipboardResult =
  | {
      ok: true
      copiedAt: string
    }
  | {
      ok: false
      message: string
    }
