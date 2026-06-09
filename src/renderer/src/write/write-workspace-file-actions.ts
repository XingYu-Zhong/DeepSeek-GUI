import i18n from '../i18n'
import { isWriteImageFilePath, isWriteWorkspaceFilePath } from '@shared/write-text-file'
import { writePathToFileUrl } from '@shared/write-markdown-resource'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import {
  emptySelection,
  filterWriteEntries,
  formatWriteImageLoadError,
  imageMimeTypeFromPath,
  initialState,
  isMissingImageIpc,
  normalizePath,
  readRememberedActiveFile,
  rememberActiveFile,
  writeDirnameFromPath
} from './write-workspace-store-helpers'

type WriteFileActions = Pick<
  WriteWorkspaceState,
  | 'initializeWorkspace'
  | 'loadDirectory'
  | 'toggleDirectory'
  | 'refreshWorkspace'
  | 'openFile'
  | 'createFile'
  | 'createDirectory'
  | 'renameEntry'
  | 'deleteEntry'
>

type WriteFileActionContext = {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
  cancelExternalSyncAnimation: () => void
  setLastSavedContent: (content: string) => void
}

function formatActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withoutLoadingDirs(
  loadingDirs: Record<string, boolean>,
  keys: Array<string | undefined>
): Record<string, boolean> {
  const next = { ...loadingDirs }
  for (const key of keys) {
    if (key) delete next[key]
  }
  return next
}

export function createWriteFileActions({
  set,
  get,
  cancelExternalSyncAnimation,
  setLastSavedContent
}: WriteFileActionContext): WriteFileActions {
  return {
    initializeWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot.trim())
      if (!normalized) {
        cancelExternalSyncAnimation()
        setLastSavedContent('')
        set(initialState())
        return
      }
      const current = get()
      if (current.workspaceRoot === normalized && current.rootDirectory) return

      setLastSavedContent('')
      cancelExternalSyncAnimation()
      set({ ...initialState(), workspaceRoot: normalized })
      const root = await get().loadDirectory(normalized)
      if (!root) return
      set((state) => ({ rootDirectory: root, expandedDirs: new Set([...state.expandedDirs, root]) }))
      const remembered = readRememberedActiveFile(normalized)
      if (remembered.trim() && isWriteWorkspaceFilePath(remembered)) {
        await get().openFile(normalized, remembered)
      } else if (remembered.trim()) {
        rememberActiveFile(normalized, null)
      }
    },

    loadDirectory: async (workspaceRoot, path) => {
      const requestedRoot = normalizePath(path || workspaceRoot)
      const targetKey = path ? requestedRoot : '__root__'
      set((state) => ({ loadingDirs: { ...state.loadingDirs, [targetKey]: true } }))
      let result: Awaited<ReturnType<typeof window.dsGui.listWorkspaceDirectory>>
      try {
        result = await window.dsGui.listWorkspaceDirectory({ workspaceRoot, path })
      } catch (error) {
        set((state) => ({
          loadingDirs: withoutLoadingDirs(state.loadingDirs, [targetKey, requestedRoot]),
          treeError: formatActionError(error)
        }))
        return null
      }
      set((state) => {
        const loadingDirs = withoutLoadingDirs(state.loadingDirs, [
          targetKey,
          requestedRoot,
          result.ok ? result.root : undefined
        ])
        return { loadingDirs }
      })
      if (!result.ok) {
        set({ treeError: result.message })
        return null
      }
      const visibleEntries = filterWriteEntries(result.entries)
      set((state) => {
        const entriesByDir = { ...state.entriesByDir, [result.root]: visibleEntries }
        if (requestedRoot && requestedRoot !== result.root) {
          entriesByDir[requestedRoot] = visibleEntries
        }
        const expandedDirs = new Set(state.expandedDirs)
        if (!path) expandedDirs.add(result.root)
        return {
          treeError: null,
          rootDirectory: !path && !state.rootDirectory ? result.root : state.rootDirectory,
          expandedDirs,
          entriesByDir
        }
      })
      return result.root
    },

    toggleDirectory: async (workspaceRoot, path) => {
      const expanded = get().expandedDirs.has(path)
      if (!expanded && !get().entriesByDir[path]) {
        await get().loadDirectory(workspaceRoot, path)
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        if (expandedDirs.has(path)) {
          expandedDirs.delete(path)
        } else {
          expandedDirs.add(path)
        }
        return { expandedDirs }
      })
    },

    refreshWorkspace: async (workspaceRoot) => {
      const state = get()
      const root = state.rootDirectory || await get().loadDirectory(workspaceRoot)
      if (!root) return
      if (!state.rootDirectory) {
        set((latest) => ({ rootDirectory: root, expandedDirs: new Set([...latest.expandedDirs, root]) }))
      }
      const latest = get()
      const targets = new Set([root, ...latest.expandedDirs])
      await Promise.all([...targets].map((dirPath) => get().loadDirectory(workspaceRoot, dirPath)))
    },

    openFile: async (workspaceRoot, path) => {
      cancelExternalSyncAnimation()
      const saved = await get().flushSave(workspaceRoot)
      if (!saved) return
      if (!isWriteWorkspaceFilePath(path)) {
        set({
          fileLoading: false,
          fileError: i18n.t('common:writeUnsupportedFileType')
        })
        return
      }
      set({ fileLoading: true, fileError: null })
      try {
        if (isWriteImageFilePath(path)) {
          const result = await window.dsGui.readWorkspaceImage({ path, workspaceRoot })
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          setLastSavedContent('')
          rememberActiveFile(workspaceRoot, result.path)
          set({
            activeFilePath: result.path,
            activeFileKind: 'image',
            fileContent: '',
            imageDataUrl: result.dataUrl,
            imageMimeType: result.mimeType,
            fileSize: result.size,
            fileTruncated: false,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            selection: emptySelection(),
            quotedSelections: []
          })
          return
        }

        const result = await window.dsGui.readWorkspaceFile({ path, workspaceRoot })
        if (!result.ok) {
          set({ fileLoading: false, fileError: result.message })
          return
        }
        setLastSavedContent(result.content)
        rememberActiveFile(workspaceRoot, result.path)
        set({
          activeFilePath: result.path,
          activeFileKind: 'text',
          fileContent: result.content,
          imageDataUrl: '',
          imageMimeType: '',
          fileSize: result.size,
          fileTruncated: result.truncated,
          fileLoading: false,
          fileError: null,
          saveStatus: 'saved',
          selection: emptySelection(),
          quotedSelections: []
        })
      } catch (error) {
        if (isWriteImageFilePath(path) && isMissingImageIpc(error)) {
          setLastSavedContent('')
          rememberActiveFile(workspaceRoot, path)
          set({
            activeFilePath: path,
            activeFileKind: 'image',
            fileContent: '',
            imageDataUrl: writePathToFileUrl(path),
            imageMimeType: imageMimeTypeFromPath(path),
            fileSize: 0,
            fileTruncated: false,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            selection: emptySelection(),
            quotedSelections: []
          })
          return
        }
        set({
          fileLoading: false,
          fileError: isWriteImageFilePath(path)
            ? formatWriteImageLoadError(error)
            : error instanceof Error ? error.message : String(error)
        })
      }
    },

    createFile: async (workspaceRoot, path, content = '') => {
      let result: Awaited<ReturnType<typeof window.dsGui.createWorkspaceFile>>
      try {
        result = await window.dsGui.createWorkspaceFile({ workspaceRoot, path, content })
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return null
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      await get().refreshWorkspace(workspaceRoot)
      await get().openFile(workspaceRoot, result.path)
      return result.path
    },

    createDirectory: async (workspaceRoot, path) => {
      let result: Awaited<ReturnType<typeof window.dsGui.createWorkspaceDirectory>>
      try {
        result = await window.dsGui.createWorkspaceDirectory({ workspaceRoot, path })
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return null
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        expandedDirs.add(writeDirnameFromPath(result.path))
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    renameEntry: async (workspaceRoot, path, newName) => {
      cancelExternalSyncAnimation()
      let result: Awaited<ReturnType<typeof window.dsGui.renameWorkspaceEntry>>
      try {
        result = await window.dsGui.renameWorkspaceEntry({ workspaceRoot, path, newName })
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return null
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      const previousPrefix = `${normalizePath(result.previousPath)}/`
      set((state) => {
        const nextActiveFilePath = state.activeFilePath === result.previousPath
          ? result.path
          : state.activeFilePath?.startsWith(previousPrefix)
            ? `${result.path}/${state.activeFilePath.slice(previousPrefix.length)}`
            : state.activeFilePath
        const keepActiveFile = nextActiveFilePath ? isWriteWorkspaceFilePath(nextActiveFilePath) : false
        const nextActiveFileKind = keepActiveFile && nextActiveFilePath
          ? isWriteImageFilePath(nextActiveFilePath) ? 'image' : 'text'
          : null
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          if (dirPath === result.previousPath) {
            expandedDirs.add(result.path)
          } else if (dirPath.startsWith(previousPrefix)) {
            expandedDirs.add(`${result.path}/${dirPath.slice(previousPrefix.length)}`)
          } else {
            expandedDirs.add(dirPath)
          }
        }
        return {
          activeFilePath: keepActiveFile ? nextActiveFilePath ?? null : null,
          activeFileKind: nextActiveFileKind,
          fileContent: nextActiveFileKind === 'text' ? state.fileContent : '',
          imageDataUrl: nextActiveFileKind === 'image' ? state.imageDataUrl : '',
          imageMimeType: nextActiveFileKind === 'image' ? state.imageMimeType : '',
          fileSize: keepActiveFile ? state.fileSize : 0,
          fileTruncated: keepActiveFile ? state.fileTruncated : false,
          saveStatus: keepActiveFile ? state.saveStatus : 'saved',
          selection: nextActiveFileKind === 'text' ? state.selection : emptySelection(),
          quotedSelections: nextActiveFileKind === 'text' ? state.quotedSelections : [],
          expandedDirs,
          entriesByDir: {},
          fileError: null
        }
      })
      if (get().activeFilePath) {
        rememberActiveFile(workspaceRoot, get().activeFilePath)
      } else {
        rememberActiveFile(workspaceRoot, null)
      }
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    deleteEntry: async (workspaceRoot, path) => {
      cancelExternalSyncAnimation()
      let result: Awaited<ReturnType<typeof window.dsGui.deleteWorkspaceEntry>>
      try {
        result = await window.dsGui.deleteWorkspaceEntry({ workspaceRoot, path })
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return false
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return false
      }
      const deletedPath = normalizePath(result.path)
      const currentActiveFilePath = get().activeFilePath
      const activePath = currentActiveFilePath ? normalizePath(currentActiveFilePath) : ''
      if (activePath === deletedPath || activePath.startsWith(`${deletedPath}/`)) {
        setLastSavedContent('')
        rememberActiveFile(workspaceRoot, null)
        set({
          activeFilePath: null,
          activeFileKind: null,
          fileContent: '',
          imageDataUrl: '',
          imageMimeType: '',
          fileSize: 0,
          fileTruncated: false,
          fileError: null,
          saveStatus: 'saved',
          selection: emptySelection(),
          quotedSelections: []
        })
      }
      set((state) => {
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          const normalizedDir = normalizePath(dirPath)
          if (normalizedDir !== deletedPath && !normalizedDir.startsWith(`${deletedPath}/`)) {
            expandedDirs.add(dirPath)
          }
        }
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return true
    }
  }
}
