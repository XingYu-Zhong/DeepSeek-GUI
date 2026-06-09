import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Columns2,
  Eye,
  FileCode2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteExportFormat } from '@shared/write-export'
import { useChatStore } from '../../store/chat-store'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import {
  useWriteWorkspaceStore,
  type WritePreviewMode,
  type WriteSaveStatus,
  writeBasenameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { getWriteRenderSafety } from '../../write/write-render-safety'
import {
  applyWriteInlineEditReplacement,
  buildWriteInlineEditCompletionRequest,
  buildWriteInlineEditDraft
} from '../../write/inline-edit'
import { createWriteRecentEdit } from '../../write/recent-edits'
import { startWriteWorkspaceFileWatch } from '../../write/write-file-watch'
import { useWriteSplitScrollSync } from './use-write-split-scroll-sync'
import { WriteWorkspaceEmptyState } from './WriteWorkspaceEmptyState'
import { WriteWorkspaceToolbar } from './WriteWorkspaceToolbar'
import { WriteInlineAgent } from './WriteInlineAgent'
import { WriteWorkspaceDocumentPane } from './WriteWorkspaceDocumentPane'
import {
  INLINE_EDIT_RECENT_CONTEXT_CHARS,
  WRITE_AUTOSAVE_MS,
  WRITE_EXPORT_NOTICE_MS,
  WRITE_PREVIEW_DEBOUNCE_MS,
  WRITE_RICH_CLIPBOARD_ACTION,
  exportFormatLabel,
  formatSaveLabel,
  inlineAgentPosition,
  isMarkdownFile,
  useDebouncedValue,
  type WriteNotice
} from './write-workspace-view-utils'

type Props = {
  leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void
  input: string; setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
}

export function WriteWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const {
    workspaceRoot,
    activeFilePath,
    activeFileKind,
    rootDirectory,
    inlineCompletion,
    inlineCompletionApiReady,
    fileContent,
    imageDataUrl,
    imageMimeType,
    fileSize,
    fileTruncated,
    fileError,
    fileLoading,
    saveStatus,
    previewMode,
    assistantOpen,
    selection,
    recentEdits,
    loadWriteSettings,
    addWriteWorkspace,
    setFileContent,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk,
    flushSave,
    createFile,
    refreshWorkspace,
    setFileError,
    setPreviewMode,
    setAssistantOpen,
    setSelection,
    recordRecentEdits,
    quoteCurrentSelection
  } = useWriteWorkspaceStore()
  const saveTimerRef = useRef<number | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)
  const editorPaneRef = useRef<HTMLDivElement | null>(null)
  const previewPaneRef = useRef<HTMLDivElement | null>(null)
  const exportNoticeTimerRef = useRef<number | null>(null)
  const inlineAgentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [inlineAgentValue, setInlineAgentValue] = useState('')
  const [inlineAgentOpen, setInlineAgentOpen] = useState(false)
  const [inlineEditInFlight, setInlineEditInFlight] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<WriteExportFormat | typeof WRITE_RICH_CLIPBOARD_ACTION | null>(null)
  const [exportNotice, setExportNotice] = useState<WriteNotice | null>(null)
  const workspaceReady = workspaceRoot.trim().length > 0
  const activeFileIsImage = activeFileKind === 'image'
  const activeFileIsText = activeFileKind === 'text'
  const isMarkdown = activeFilePath && activeFileIsText ? isMarkdownFile(activeFilePath) : true
  const renderSafety = getWriteRenderSafety({
    isMarkdown,
    contentLength: fileContent.length,
    fileSize,
    truncated: fileTruncated
  })
  const debouncedPreviewContent = useDebouncedValue(fileContent, WRITE_PREVIEW_DEBOUNCE_MS)
  const saveLabel = activeFileIsImage
    ? t('writeImagePreview')
    : renderSafety.readOnly ? t('writeReadOnly') : formatSaveLabel(saveStatus, t)
  const selectionAction = selection.charCount > 0 ? inlineAgentPosition(selection) : null
  const selectionActionActive = Boolean(selectionAction)
  const selectionActionLeft = selectionAction?.left
  const selectionActionTop = selectionAction?.top
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const activeFileName = activeFilePath ? writeBasenameFromPath(activeFilePath) : t('writeStudio')
  const workspacePathLabel = rootDirectory || workspaceRoot
  const workspaceName = workspacePathLabel ? writeBasenameFromPath(workspacePathLabel) : t('writeWorkspace')
  const exportInFlight = exportingFormat !== null
  const fileGuardMessage = renderSafety.notice === 'truncated'
    ? t('writeLargeFileTruncated')
    : renderSafety.notice === 'large-file'
      ? t('writeLargeFileSafeMode')
      : ''
  const fileGuardDetail = renderSafety.notice === 'large-file' ? t('writeLargeFileSafeModeSub') : ''

  useWriteSplitScrollSync({
    enabled: workspaceReady && previewMode === 'split' && activeFileIsText,
    editorRootRef: editorPaneRef,
    previewRef: previewPaneRef,
    rebindKey: activeFilePath ?? 'write-preview'
  })

  const showExportNotice = (notice: WriteNotice): void => {
    setExportNotice(notice)
  }

  const createDraftFile = async (): Promise<void> => {
    if (!workspaceReady) {
      await pickWriteWorkspace()
      return
    }
    const root = rootDirectory || workspaceRoot
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = writeJoinPath(root, `draft-${stamp}.md`)
    await createFile(workspaceRoot, path, `# ${t('writeUntitledDraft')}\n\n`)
  }

  const setAssistantPrompt = (prompt: string): void => {
    setAssistantOpen(true)
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }

  const submitInlineAgent = (prompt: string): void => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath) return
    quoteCurrentSelection(workspaceRoot)
    setAssistantOpen(true)
    setInlineAgentValue('')
    setInlineAgentOpen(false)
    if (onSubmitPrompt) {
      onSubmitPrompt(trimmed)
      return
    }
    setInput(input.trim() ? `${input.trim()}\n\n${trimmed}` : trimmed)
  }

  const submitInlineEdit = async (prompt: string): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath || inlineEditInFlight) return
    if (renderSafety.readOnly) {
      setFileError(t('writeReadOnlySaveDisabled'))
      return
    }
    if (selection.ranges.length !== 1) {
      setFileError(t(selection.ranges.length > 1 ? 'writeInlineEditMultiSelection' : 'writeInlineEditNoSelection'))
      return
    }
    if (typeof window.dsGui?.requestWriteInlineCompletion !== 'function') {
      setFileError(t('writeInlineEditUnavailable'))
      return
    }

    const draft = buildWriteInlineEditDraft(fileContent, selection.ranges[0], trimmed, {
      workspaceRoot,
      currentFilePath: activeFilePath,
      model: inlineCompletion.model,
      language: 'markdown',
      recentEdits
    })

    setInlineEditInFlight(true)
    try {
      const result = await window.dsGui.requestWriteInlineCompletion(
        buildWriteInlineEditCompletionRequest(draft.request)
      )
      if (!result.ok) {
        setFileError(t('writeInlineEditFailed', { message: result.message }))
        return
      }
      const replacement = result.action?.kind === 'edit'
        ? result.action.replacement
        : result.completion

      const latest = useWriteWorkspaceStore.getState()
      if (
        latest.activeFilePath !== activeFilePath ||
        latest.activeFileKind !== 'text' ||
        latest.fileContent.slice(draft.scope.from, draft.scope.to) !== draft.scope.text
      ) {
        setFileError(t('writeInlineEditChanged'))
        return
      }

      const nextContent = applyWriteInlineEditReplacement(latest.fileContent, draft.scope, replacement)
      const inlineEditRecord = createWriteRecentEdit({
        source: 'inline-edit',
        filePath: activeFilePath,
        from: draft.scope.from,
        to: draft.scope.to,
        deletedText: draft.scope.text,
        insertedText: replacement,
        beforeContext: latest.fileContent.slice(
          Math.max(0, draft.scope.from - INLINE_EDIT_RECENT_CONTEXT_CHARS),
          draft.scope.from
        ),
        afterContext: nextContent.slice(
          draft.scope.from + replacement.length,
          Math.min(nextContent.length, draft.scope.from + replacement.length + INLINE_EDIT_RECENT_CONTEXT_CHARS)
        ),
        instruction: trimmed,
        scopeKind: draft.scope.kind
      })

      setFileContent(nextContent)
      if (inlineEditRecord) recordRecentEdits([inlineEditRecord])
      setSelection({ text: '', ranges: [], charCount: 0 })
      setInlineAgentValue('')
      setInlineAgentOpen(false)
      setFileError(null)
      showExportNotice({ tone: 'success', message: t('writeInlineEditApplied') })
    } catch (error) {
      setFileError(t('writeInlineEditFailed', {
        message: error instanceof Error ? error.message : String(error)
      }))
    } finally {
      setInlineEditInFlight(false)
    }
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(workspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        await addWriteWorkspace(picked.path)
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const exportCurrentFile = async (format: WriteExportFormat): Promise<void> => {
    if (!activeFilePath) return
    if (!activeFileIsText) return
    if (typeof window.dsGui?.exportWriteDocument !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeExportUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(format)
    try {
      const result = await window.dsGui.exportWriteDocument({
        path: activeFilePath,
        workspaceRoot,
        format,
        content: fileContent
      })
      if (!result.ok) {
        if (!result.canceled) {
          showExportNotice({
            tone: 'error',
            message: t('writeExportFailed', {
              format: exportFormatLabel(format, t),
              message: result.message
            })
          })
        }
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeExportSuccess', { format: exportFormatLabel(format, t) })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeExportFailed', {
          format: exportFormatLabel(format, t),
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  const copyCurrentFileAsRichText = async (): Promise<void> => {
    if (!activeFilePath) return
    if (!activeFileIsText) return
    if (typeof window.dsGui?.copyWriteDocumentAsRichText !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeCopyRichTextUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(WRITE_RICH_CLIPBOARD_ACTION)
    try {
      const result = await window.dsGui.copyWriteDocumentAsRichText({
        path: activeFilePath,
        workspaceRoot,
        content: fileContent
      })
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writeCopyRichTextFailed', {
            message: result.message
          })
        })
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeCopyRichTextSuccess')
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeCopyRichTextFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    setExportMenuOpen(false)
  }, [activeFilePath])

  useEffect(() => {
    setModeMenuOpen(false)
  }, [activeFilePath, previewMode])

  useEffect(() => {
    if (!selectionActionActive || !inlineAgentOpen) return
    window.requestAnimationFrame(() => inlineAgentTextareaRef.current?.focus())
  }, [inlineAgentOpen, selectionActionActive, selectionActionLeft, selectionActionTop])

  useEffect(() => {
    setInlineAgentOpen(false)
    setInlineAgentValue('')
  }, [selection.charCount, selection.text])

  useEffect(() => {
    if (!exportMenuOpen && !modeMenuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        exportMenuRef.current &&
        target instanceof Node &&
        !exportMenuRef.current.contains(target)
      ) {
        setExportMenuOpen(false)
      }
      if (
        modeMenuRef.current &&
        target instanceof Node &&
        !modeMenuRef.current.contains(target)
      ) {
        setModeMenuOpen(false)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setExportMenuOpen(false)
      setModeMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen, modeMenuOpen])

  useEffect(() => {
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
    if (!exportNotice) return
    exportNoticeTimerRef.current = window.setTimeout(() => {
      exportNoticeTimerRef.current = null
      setExportNotice(null)
    }, WRITE_EXPORT_NOTICE_MS)
    return () => {
      if (exportNoticeTimerRef.current) {
        window.clearTimeout(exportNoticeTimerRef.current)
        exportNoticeTimerRef.current = null
      }
    }
  }, [exportNotice])

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (saveStatus !== 'dirty' || !workspaceReady || !activeFileIsText || renderSafety.readOnly) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSave(workspaceRoot)
    }, WRITE_AUTOSAVE_MS)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [flushSave, saveStatus, workspaceReady, workspaceRoot, fileContent, activeFileIsText, renderSafety.readOnly])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
    void useWriteWorkspaceStore.getState().flushSave(workspaceRoot)
  }, [workspaceRoot])

  useEffect(() => {
    if (!activeFilePath || !workspaceRoot.trim() || (!activeFileIsText && !activeFileIsImage)) return
    if (
      typeof window.dsGui?.watchWorkspaceFile !== 'function' ||
      typeof window.dsGui?.unwatchWorkspaceFile !== 'function' ||
      typeof window.dsGui?.onWorkspaceFileChanged !== 'function'
    ) {
      return
    }

    return startWriteWorkspaceFileWatch({
      api: window.dsGui,
      workspaceRoot,
      path: activeFilePath,
      kind: activeFileIsImage ? 'image' : 'text',
      onTextSnapshot: (snapshot) => {
        void syncActiveFileFromDisk(workspaceRoot, snapshot)
      },
      onImageChanged: (path) => {
        void syncActiveImageFromDisk(workspaceRoot, path)
      },
      onError: setFileError
    })
  }, [
    activeFilePath,
    activeFileIsImage,
    activeFileIsText,
    setFileError,
    workspaceRoot,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk
  ])

  if (!workspaceReady) {
    return <WriteWorkspaceEmptyState error={fileError} onPickWorkspace={() => void pickWriteWorkspace()} />
  }

  const editorVisible = activeFileIsText && previewMode !== 'preview'
  const previewVisible = activeFileIsText && (previewMode === 'split' || previewMode === 'preview')
  const editorWidth = previewMode === 'split'
    ? 'min-w-0 flex-1 basis-1/2 border-r border-ds-border-muted'
    : 'min-w-0 flex-1'
  const previewWidth = previewMode === 'split'
    ? 'min-w-0 flex-1 basis-1/2'
    : 'min-w-0 flex-1'
  const liveModeActive = previewMode === 'live' && renderSafety.livePreviewEnabled
  const sourceModeActive = previewMode === 'source' || (previewMode === 'live' && !renderSafety.livePreviewEnabled)
  const editorAppearance = sourceModeActive ? 'source' : 'live'

  const modeMenuItems: Array<{ mode: WritePreviewMode; label: string; shortLabel: string; icon: ReactElement; active: boolean }> = [
    {
      mode: 'source',
      label: t('writeModeSource'),
      shortLabel: t('writeModeSource'),
      icon: <FileCode2 className="h-4 w-4" strokeWidth={1.85} />,
      active: sourceModeActive
    },
    {
      mode: 'split',
      label: t('writeModeSplit'),
      shortLabel: t('writeModeSplit'),
      icon: <Columns2 className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'split'
    },
    {
      mode: 'preview',
      label: t('writeModePreview'),
      shortLabel: t('writeModePreview'),
      icon: <Eye className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'preview'
    }
  ]

  return (
    <div className="write-workspace-view ds-no-drag flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 sm:px-4 md:px-6 lg:px-8">
      <WriteWorkspaceToolbar
        activeFileIsImage={activeFileIsImage}
        activeFileIsText={activeFileIsText}
        activeFileLabel={activeFileLabel}
        activeFileName={activeFileName}
        activeFilePath={activeFilePath ?? ''}
        assistantOpen={assistantOpen}
        exportInFlight={exportInFlight}
        exportMenuOpen={exportMenuOpen}
        exportMenuRef={exportMenuRef}
        leftSidebarCollapsed={leftSidebarCollapsed}
        liveModeActive={liveModeActive}
        modeMenuItems={modeMenuItems}
        modeMenuOpen={modeMenuOpen}
        modeMenuRef={modeMenuRef}
        previewMode={previewMode}
        readOnly={renderSafety.readOnly}
        saveLabel={saveLabel}
        saveStatus={saveStatus}
        setAssistantOpen={setAssistantOpen}
        setExportMenuOpen={setExportMenuOpen}
        setModeMenuOpen={setModeMenuOpen}
        setPreviewMode={setPreviewMode}
        onCopyRichText={() => void copyCurrentFileAsRichText()}
        onExportFile={(format) => void exportCurrentFile(format)}
        onPickWorkspace={() => void pickWriteWorkspace()}
        onSave={() => {
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
          void flushSave(workspaceRoot)
        }}
        onToggleLeftSidebar={onToggleLeftSidebar}
      />
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden pb-3 pt-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-[28px] border border-ds-border bg-ds-card/88 shadow-[0_20px_56px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          <WriteWorkspaceDocumentPane
            activeFilePath={activeFilePath}
            activeFileIsImage={activeFileIsImage}
            activeFileIsText={activeFileIsText}
            fileLoading={fileLoading}
            fileContent={fileContent}
            imageDataUrl={imageDataUrl}
            imageMimeType={imageMimeType}
            fileSize={fileSize}
            workspaceRoot={workspaceRoot}
            workspaceName={workspaceName}
            workspacePathLabel={workspacePathLabel}
            renderSafety={renderSafety}
            fileGuardMessage={fileGuardMessage}
            fileGuardDetail={fileGuardDetail}
            editorVisible={editorVisible}
            previewVisible={previewVisible}
            editorWidth={editorWidth}
            previewWidth={previewWidth}
            editorAppearance={editorAppearance}
            debouncedPreviewContent={debouncedPreviewContent}
            isMarkdown={isMarkdown}
            inlineCompletion={inlineCompletion}
            inlineCompletionApiReady={inlineCompletionApiReady}
            recentEdits={recentEdits}
            editorPaneRef={editorPaneRef}
            previewPaneRef={previewPaneRef}
            onAskAssistant={() => setAssistantPrompt(t('writeStartAskAiPrompt'))}
            onCreateDraft={() => void createDraftFile()}
            onPickWorkspace={() => void pickWriteWorkspace()}
            onRefreshWorkspace={() => void refreshWorkspace(workspaceRoot)}
            onContentChange={setFileContent}
            onDocumentEdit={recordRecentEdits}
            onSelectionChange={setSelection}
            onSaveShortcut={() => {
              if (renderSafety.readOnly) return
              if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
              void flushSave(workspaceRoot)
            }}
            onImagePasteSaved={() => {
              setFileError(null)
              void refreshWorkspace(workspaceRoot)
            }}
            onImagePasteError={(message) => setFileError(message)}
          />
        </div>

      </div>
      {selectionAction && activeFilePath && activeFileIsText ? (
        <WriteInlineAgent
          action={selectionAction}
          open={inlineAgentOpen}
          value={inlineAgentValue}
          inFlight={inlineEditInFlight}
          textareaRef={inlineAgentTextareaRef}
          onOpen={() => setInlineAgentOpen(true)}
          onClose={() => setInlineAgentOpen(false)}
          onValueChange={setInlineAgentValue}
          onSubmitPrompt={submitInlineAgent}
          onApplyEdit={(value) => void submitInlineEdit(value)}
        />
      ) : null}

      {fileError ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-200/70 bg-red-50/92 px-4 py-2 text-[13px] text-red-700 shadow-[0_14px_32px_rgba(15,23,42,0.12)] dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200">
          {fileError}
        </div>
      ) : null}
      {exportNotice ? (
        <div
          className={`pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-[13px] shadow-[0_14px_32px_rgba(15,23,42,0.12)] ${
            exportNotice.tone === 'error'
              ? 'border-red-200/70 bg-red-50/92 text-red-700 dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200'
              : 'border-emerald-200/80 bg-emerald-50/92 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/84 dark:text-emerald-200'
          }`}
          style={{ bottom: fileError ? 68 : 20 }}
        >
          {exportNotice.message}
        </div>
      ) : null}
    </div>
  )
}
