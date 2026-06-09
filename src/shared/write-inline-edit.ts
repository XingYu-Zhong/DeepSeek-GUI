export type WriteInlineEditScopeKind = 'selection' | 'paragraph'
export type WriteInlineEditRecentEditSource = 'user' | 'inline-edit'

export type WriteInlineEditRecentEdit = {
  source: WriteInlineEditRecentEditSource
  ageMs: number
  filePath?: string
  from: number
  to: number
  deletedText: string
  insertedText: string
  beforeContext: string
  afterContext: string
  instruction?: string
  scopeKind?: WriteInlineEditScopeKind
}

export type WriteInlineEditRequest = {
  prefix: string
  suffix: string
  original: string
  instruction: string
  workspaceRoot?: string
  currentFilePath?: string
  scope: {
    kind: WriteInlineEditScopeKind
    from: number
    to: number
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
  context: {
    language: string
    selectedText: string
    previousLine: string
    previousNonEmptyLine: string
    nextLine: string
  }
  preview: {
    local: string
    documentTail: string
  }
  recentEdits?: WriteInlineEditRecentEdit[]
  model?: string
}
