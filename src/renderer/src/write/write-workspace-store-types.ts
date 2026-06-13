import type { WriteInlineCompletionSettingsV1, WriteSelectionAssistSettingsV1 } from '@shared/app-settings'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'
import type { WriteQuotedSelection } from './quoted-selection'
import type { WriteRecentEdit } from './recent-edits'

export type WritePreviewMode = 'rich' | 'source' | 'live' | 'split' | 'preview'
export type WriteSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type WriteActiveFileKind = 'text' | 'image' | 'pdf'

export type WriteWorkspaceState = {
  defaultWorkspaceRoot: string
  workspaceRoots: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  inlineCompletionApiReady: boolean
  /** Selection toolbar AI assists: quick action prompts + infographic prompt. */
  selectionAssist: WriteSelectionAssistSettingsV1
  /** True when the image generation provider is fully configured (enables 生成信息图). */
  imageGenReady: boolean
  /** True when the primary chat provider is configured (enables 生成交互原型). */
  prototypeReady: boolean
  settingsLoading: boolean
  settingsError: string | null
  workspaceRoot: string
  rootDirectory: string
  entriesByDir: Record<string, WorkspaceEntry[]>
  expandedDirs: Set<string>
  loadingDirs: Record<string, boolean>
  treeError: string | null
  activeFilePath: string | null
  activeFileKind: WriteActiveFileKind | null
  fileContent: string
  imageDataUrl: string
  imageMimeType: string
  pdfDataBase64: string
  pdfMimeType: string
  pdfMtimeMs: number
  fileSize: number
  fileTruncated: boolean
  fileError: string | null
  fileLoading: boolean
  saveStatus: WriteSaveStatus
  previewMode: WritePreviewMode
  assistantOpen: boolean
  assistantModel: string
  assistantProviderId: string
  selection: WriteEditorSelectionState
  quotedSelections: WriteQuotedSelection[]
  recentEdits: WriteRecentEdit[]
  loadWriteSettings: () => Promise<void>
  selectWriteWorkspace: (workspaceRoot: string) => Promise<void>
  addWriteWorkspace: (workspaceRoot: string) => Promise<void>
  removeWriteWorkspace: (workspaceRoot: string) => Promise<void>
  initializeWorkspace: (workspaceRoot: string) => Promise<void>
  loadDirectory: (workspaceRoot: string, path?: string) => Promise<string | null>
  toggleDirectory: (workspaceRoot: string, path: string) => Promise<void>
  refreshWorkspace: (workspaceRoot: string) => Promise<void>
  openFile: (workspaceRoot: string, path: string) => Promise<void>
  setFileContent: (content: string) => void
  syncActiveFileFromDisk: (
    workspaceRoot: string,
    options?: {
      path?: string
      content?: string
      size?: number
      truncated?: boolean
      message?: string
      animate?: boolean
      force?: boolean
    }
  ) => Promise<boolean>
  syncActiveImageFromDisk: (workspaceRoot: string, path?: string) => Promise<boolean>
  flushSave: (workspaceRoot: string) => Promise<boolean>
  createFile: (workspaceRoot: string, path: string, content?: string) => Promise<string | null>
  createDirectory: (workspaceRoot: string, path: string) => Promise<string | null>
  renameEntry: (workspaceRoot: string, path: string, newName: string) => Promise<string | null>
  deleteEntry: (workspaceRoot: string, path: string) => Promise<boolean>
  setFileError: (message: string | null) => void
  setPreviewMode: (mode: WritePreviewMode) => void
  setAssistantOpen: (open: boolean) => void
  setAssistantModel: (model: string, providerId?: string) => void
  setSelection: (selection: WriteEditorSelectionState) => void
  recordRecentEdits: (edits: WriteRecentEdit[]) => void
  quoteCurrentSelection: (workspaceRoot: string) => void
  removeQuotedSelection: (id: string) => void
  clearQuotedSelections: () => void
  resetWorkspace: () => void
}

export type WriteWorkspaceSet = (
  partial: Partial<WriteWorkspaceState> | ((state: WriteWorkspaceState) => Partial<WriteWorkspaceState>)
) => void

export type WriteWorkspaceGet = () => WriteWorkspaceState
