import { create } from 'zustand'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
  defaultWriteSelectionAssistSettings
} from '@shared/app-settings'
import { quotedSelectionFromEditor } from './quoted-selection'
import { writeSelectionStatesEqual } from './write-selection'
import { trimWriteRecentEdits } from './recent-edits'
import type { WriteWorkspaceState } from './write-workspace-store-types'
import { createWriteSettingsActions } from './write-workspace-settings-actions'
import { createWriteFileActions } from './write-workspace-file-actions'
import { writeBrowserStorageItem } from '../lib/browser-storage'
import {
  WRITE_ASSISTANT_MODEL_KEY,
  WRITE_ASSISTANT_PROVIDER_KEY,
  WRITE_ASSISTANT_OPEN_KEY,
  WRITE_PREVIEW_MODE_KEY,
  commonPrefixLength,
  emptySelection,
  formatWriteImageLoadError,
  initialState,
  isMissingImageIpc,
  normalizeWriteAssistantModel,
  pathsEqual,
  readStoredAssistantModel,
  readStoredAssistantOpen,
  readStoredAssistantProviderId,
  readStoredPreviewMode,
  writeBasenameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from './write-workspace-store-helpers'
export type { WriteActiveFileKind, WritePreviewMode, WriteSaveStatus, WriteWorkspaceState } from './write-workspace-store-types'
export { writeBasenameFromPath, writeDirnameFromPath, writeJoinPath, writeRelativeToWorkspace } from './write-workspace-store-helpers'

const MAX_ANIMATED_EXTERNAL_SYNC_CHARS = 120_000

let lastSavedContent = ''
let externalSyncTimer: number | null = null
let externalSyncAnimationToken = 0

function cancelExternalSyncAnimation(): void {
  externalSyncAnimationToken += 1
  if (externalSyncTimer !== null) {
    window.clearTimeout(externalSyncTimer)
    externalSyncTimer = null
  }
}


export const useWriteWorkspaceStore = create<WriteWorkspaceState>((set, get) => ({
  defaultWorkspaceRoot: '',
  workspaceRoots: [],
  inlineCompletion: {
    enabled: true,
    retrievalEnabled: true,
    longCompletionEnabled: true,
    inheritProvider: true,
    providerId: '',
    apiKey: '',
    baseUrl: '',
    inheritModel: true,
    model: DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
    debounceMs: DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
    longDebounceMs: DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
    minAcceptScore: DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
    longMinAcceptScore: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
    maxTokens: DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
    longMaxTokens: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
  },
  inlineCompletionApiReady: false,
  selectionAssist: defaultWriteSelectionAssistSettings(),
  imageGenReady: false,
  prototypeReady: false,
  settingsLoading: false,
  settingsError: null,
  ...initialState(),
  previewMode: readStoredPreviewMode(),
  assistantOpen: readStoredAssistantOpen(),
  assistantModel: readStoredAssistantModel(),
  assistantProviderId: readStoredAssistantProviderId(),

  ...createWriteSettingsActions({ set, get }),
  ...createWriteFileActions({
    set,
    get,
    cancelExternalSyncAnimation,
    setLastSavedContent: (content) => {
      lastSavedContent = content
    }
  }),

  setFileContent: (content) => {
    cancelExternalSyncAnimation()
    set((state) => ({
      fileContent: content,
      saveStatus: state.activeFileKind === 'text' && state.activeFilePath && content !== lastSavedContent ? 'dirty' : 'saved'
    }))
  },

  syncActiveFileFromDisk: async (workspaceRoot, options = {}) => {
    const snapshot = get()
    const force = options.force === true
    if (!snapshot.activeFilePath) return false
    if (snapshot.activeFileKind !== 'text') return false
    if (!force && (snapshot.saveStatus === 'dirty' || snapshot.saveStatus === 'saving')) return false
    if (options.path && !pathsEqual(options.path, snapshot.activeFilePath)) return false

    if (options.message) {
      set({ fileError: options.message, saveStatus: 'error' })
      return false
    }

    let content = options.content
    let resolvedPath = options.path ?? snapshot.activeFilePath
    let size = options.size
    let truncated = options.truncated
    if (typeof content !== 'string') {
      let result: Awaited<ReturnType<typeof window.kunGui.readWorkspaceFile>>
      try {
        result = await window.kunGui.readWorkspaceFile({
          path: snapshot.activeFilePath,
          workspaceRoot
        })
      } catch (error) {
        if (pathsEqual(get().activeFilePath ?? '', snapshot.activeFilePath)) {
          set({
            fileError: error instanceof Error ? error.message : String(error),
            saveStatus: 'error'
          })
        }
        return false
      }
      if (!result.ok) {
        if (pathsEqual(get().activeFilePath ?? '', snapshot.activeFilePath)) {
          set({ fileError: result.message, saveStatus: 'error' })
        }
        return false
      }
      content = result.content
      resolvedPath = result.path
      size = result.size
      truncated = result.truncated
    }

    const nextSize = typeof size === 'number' && Number.isFinite(size)
      ? Math.max(0, Math.floor(size))
      : content.length
    const nextTruncated = truncated === true

    const latest = get()
    if (!latest.activeFilePath || !pathsEqual(latest.activeFilePath, resolvedPath)) return false
    if (!force && (latest.saveStatus === 'dirty' || latest.saveStatus === 'saving')) return false
    if (
      latest.fileContent === content &&
      lastSavedContent === content &&
      latest.fileSize === nextSize &&
      latest.fileTruncated === nextTruncated
    ) {
      set({
        saveStatus: 'saved',
        fileError: null,
        fileLoading: false,
        fileSize: nextSize,
        fileTruncated: nextTruncated
      })
      return true
    }

    cancelExternalSyncAnimation()
    lastSavedContent = content

    if (
      options.animate !== false &&
      !nextTruncated &&
      content.length <= MAX_ANIMATED_EXTERNAL_SYNC_CHARS &&
      content.length > latest.fileContent.length
    ) {
      const token = externalSyncAnimationToken
      const prefix = commonPrefixLength(latest.fileContent, content)
      let cursor = prefix
      set({
        fileContent: content.slice(0, prefix),
        fileSize: nextSize,
        fileTruncated: nextTruncated,
        saveStatus: 'saved',
        fileError: null,
        fileLoading: false
      })
      const step = (): void => {
        if (token !== externalSyncAnimationToken) return
        const remaining = content.length - cursor
        const chunk = Math.max(24, Math.ceil(remaining * 0.1))
        cursor = Math.min(content.length, cursor + chunk)
        set({
          fileContent: content.slice(0, cursor),
          fileSize: nextSize,
          fileTruncated: nextTruncated,
          saveStatus: 'saved',
          fileError: null,
          fileLoading: false
        })
        if (cursor < content.length) {
          externalSyncTimer = window.setTimeout(step, 16)
        } else {
          externalSyncTimer = null
        }
      }
      externalSyncTimer = window.setTimeout(step, 16)
      return true
    }

    set({
      fileContent: content,
      fileSize: nextSize,
      fileTruncated: nextTruncated,
      saveStatus: 'saved',
      fileError: null,
      fileLoading: false
    })
    return true
  },

  syncActiveImageFromDisk: async (workspaceRoot, path) => {
    const snapshot = get()
    if (!snapshot.activeFilePath || snapshot.activeFileKind !== 'image') return false
    if (path && !pathsEqual(path, snapshot.activeFilePath)) return false

    try {
      const result = await window.kunGui.readWorkspaceImage({
        path: snapshot.activeFilePath,
        workspaceRoot
      })
      if (!result.ok) {
        if (pathsEqual(get().activeFilePath ?? '', snapshot.activeFilePath)) {
          set({ fileError: result.message })
        }
        return false
      }

      const latest = get()
      if (!latest.activeFilePath || latest.activeFileKind !== 'image' || !pathsEqual(latest.activeFilePath, result.path)) {
        return false
      }

      set({
        imageDataUrl: result.dataUrl,
        imageMimeType: result.mimeType,
        fileSize: result.size,
        fileError: null,
        fileLoading: false,
        saveStatus: 'saved'
      })
      return true
    } catch (error) {
      if (isMissingImageIpc(error)) return false
      if (pathsEqual(get().activeFilePath ?? '', snapshot.activeFilePath)) {
        set({ fileError: formatWriteImageLoadError(error) })
      }
      return false
    }
  },

  flushSave: async (workspaceRoot) => {
    const state = get()
    if (!state.activeFilePath) return true
    if (state.activeFileKind !== 'text') return true
    if (state.fileTruncated) return false
    if (externalSyncTimer !== null) {
      cancelExternalSyncAnimation()
      set({ fileContent: lastSavedContent, saveStatus: 'saved', fileError: null })
      return true
    }
    cancelExternalSyncAnimation()
    if (state.fileContent === lastSavedContent) {
      set({ saveStatus: 'saved' })
      return true
    }
    set({ saveStatus: 'saving' })
    try {
      const result = await window.kunGui.writeWorkspaceFile({
        path: state.activeFilePath,
        workspaceRoot,
        content: state.fileContent
      })
      if (!result.ok) {
        set({ saveStatus: 'error', fileError: result.message })
        return false
      }
      lastSavedContent = state.fileContent
      set({ saveStatus: 'saved', fileError: null })
      return true
    } catch (error) {
      set({
        saveStatus: 'error',
        fileError: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  },

  setFileError: (message) => {
    set({ fileError: message })
  },

  setPreviewMode: (mode) => {
    writeBrowserStorageItem(WRITE_PREVIEW_MODE_KEY, mode)
    set({ previewMode: mode })
  },

  setAssistantOpen: (open) => {
    writeBrowserStorageItem(WRITE_ASSISTANT_OPEN_KEY, open ? '1' : '0')
    set({ assistantOpen: open })
  },

  setAssistantModel: (model, providerId) => {
    const normalized = normalizeWriteAssistantModel(model)
    writeBrowserStorageItem(WRITE_ASSISTANT_MODEL_KEY, normalized)
    const normalizedProviderId = providerId?.trim() ?? ''
    writeBrowserStorageItem(WRITE_ASSISTANT_PROVIDER_KEY, normalizedProviderId)
    set({ assistantModel: normalized, assistantProviderId: normalizedProviderId })
  },

  setSelection: (selection) => {
    if (writeSelectionStatesEqual(get().selection, selection)) return
    set({ selection })
  },

  recordRecentEdits: (edits) => {
    if (edits.length === 0) return
    set((state) => ({
      recentEdits: trimWriteRecentEdits([...state.recentEdits, ...edits])
    }))
  },

  quoteCurrentSelection: (workspaceRoot) => {
    const state = get()
    if (!state.activeFilePath) return
    const quote = quotedSelectionFromEditor(state.selection, state.activeFilePath, workspaceRoot)
    if (!quote) return
    set((current) => ({
      assistantOpen: true,
      quotedSelections: [...current.quotedSelections, quote],
      selection: emptySelection()
    }))
  },

  removeQuotedSelection: (id) =>
    set((state) => ({
      quotedSelections: state.quotedSelections.filter((selection) => selection.id !== id)
    })),

  clearQuotedSelections: () => set({ quotedSelections: [] }),

  resetWorkspace: () => {
    cancelExternalSyncAnimation()
    lastSavedContent = ''
    set(initialState())
  }
}))
