import type { WriteInlineCompletionSettingsV1 } from '@shared/app-settings'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'
import type { WriteQuotedSelection } from './quoted-selection'
import type { WriteRecentEdit } from './recent-edits'

export type WritePreviewMode = 'source' | 'live' | 'split' | 'preview'
export type WriteSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type WriteActiveFileKind = 'text' | 'image'

export type WriteWorkspaceState = {
  defaultWorkspaceRoot: string
  workspaceRoots: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  inlineCompletionApiReady: boolean
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
  fileSize: number
  fileTruncated: boolean
  fileError: string | null
  fileLoading: boolean
  saveStatus: WriteSaveStatus
  previewMode: WritePreviewMode
  assistantOpen: boolean
  assistantModel: string
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
  setAssistantModel: (model: string) => void
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
