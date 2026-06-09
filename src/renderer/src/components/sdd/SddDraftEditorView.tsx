import { useEffect, useRef, type ReactElement } from 'react'
import { ArrowRight, FileText, Loader2, Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { SDD_IMAGE_RELATIVE_DIR } from '@shared/sdd'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import { saveActiveSddDraftToDisk } from '../../sdd/sdd-draft-actions'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { WriteMarkdownEditor } from '../write/WriteMarkdownEditor'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

const SDD_AUTOSAVE_MS = 650

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onNext: () => void
  onClose: () => void
  nextDisabled: boolean
}

function statusKey(saveStatus: string, operationStatus: string): string {
  if (operationStatus === 'upgrading') return 'sddStatusUpgrading'
  if (operationStatus === 'error' || saveStatus === 'error') return 'sddStatusError'
  if (saveStatus === 'saving') return 'sddStatusSaving'
  if (saveStatus === 'dirty') return 'sddStatusDirty'
  return 'sddStatusSaved'
}

export function SddDraftEditorView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onNext,
  onClose,
  nextDisabled
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const saveTimerRef = useRef<number | null>(null)
  const {
    activeDraft,
    content,
    saveStatus,
    operationStatus,
    error,
    setContent,
    setOperationStatus
  } = useSddDraftStore(
    useShallow((s) => ({
      activeDraft: s.activeDraft,
      content: s.content,
      saveStatus: s.saveStatus,
      operationStatus: s.operationStatus,
      error: s.error,
      setContent: s.setContent,
      setOperationStatus: s.setOperationStatus
    }))
  )
  const {
    inlineCompletion,
    inlineCompletionApiReady,
    recentEdits,
    loadWriteSettings,
    setSelection,
    recordRecentEdits
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      inlineCompletion: s.inlineCompletion,
      inlineCompletionApiReady: s.inlineCompletionApiReady,
      recentEdits: s.recentEdits,
      loadWriteSettings: s.loadWriteSettings,
      setSelection: s.setSelection,
      recordRecentEdits: s.recordRecentEdits
    }))
  )

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!activeDraft || saveStatus !== 'dirty') return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void saveActiveSddDraftToDisk()
    }, SDD_AUTOSAVE_MS)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [activeDraft, content, saveStatus])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    void saveActiveSddDraftToDisk()
  }, [])

  if (!activeDraft) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[14px] text-ds-muted">
        {t('sddNoActiveDraft')}
      </div>
    )
  }

  const upgrading = operationStatus === 'upgrading'
  const readOnly = upgrading
  const statusLabel = t(statusKey(saveStatus, operationStatus))

  return (
    <section className="sdd-draft-shell ds-no-drag flex min-h-0 min-w-0 flex-1 flex-col px-3 sm:px-4 md:px-6 lg:px-8">
      <div className="ds-stage-inset -mx-3 shrink-0 sm:-mx-4 md:-mx-6 lg:-mx-8">
        <header className="sdd-draft-topbar ds-topbar-surface relative z-10 mt-3 flex min-h-[56px] w-full items-stretch overflow-visible rounded-[18px]">
          <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
              }`}
            >
              {leftSidebarCollapsed ? (
                <SidebarTitlebarToggleButton
                  onClick={onToggleLeftSidebar}
                  title={t('sidebarExpand')}
                  ariaLabel={t('sidebarExpand')}
                />
              ) : null}
              <span className="sdd-draft-file-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <FileText className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1 leading-none">
                <div className="truncate text-[15px] font-semibold text-ds-ink">
                  {t('sddDraftTitle')}
                </div>
                <div className="mt-1.5 truncate text-[12px] text-ds-faint">
                  {activeDraft.relativePath}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 items-center justify-end gap-1.5">
              <span
                aria-live="polite"
                className={`sdd-status-pill inline-flex min-w-[72px] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${
                  readOnly
                    ? 'is-upgrading bg-sky-500/12 text-sky-700 dark:text-sky-300'
                    : saveStatus === 'error'
                      ? 'bg-red-500/12 text-red-600 dark:text-red-300'
                      : saveStatus === 'dirty'
                        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {readOnly || saveStatus === 'saving' ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : (
                  <Save className="h-3 w-3" strokeWidth={1.8} />
                )}
                {statusLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
                  void saveActiveSddDraftToDisk()
                }}
                disabled={readOnly || saveStatus === 'saved'}
                className="ds-sidebar-toggle-button disabled:cursor-not-allowed disabled:opacity-45"
                title={t('writeSaveFile')}
                aria-label={t('writeSaveFile')}
              >
                <Save className="h-4 w-4" strokeWidth={1.85} />
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={nextDisabled || readOnly}
                className="sdd-next-button inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {readOnly ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {t('sddNextStep')}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={readOnly}
                className="ds-sidebar-toggle-button disabled:cursor-not-allowed disabled:opacity-45"
                title={t('close')}
                aria-label={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </header>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden pb-3 pt-3">
        <div
          className={`sdd-editor-card relative h-full min-h-0 overflow-hidden rounded-[18px] border border-ds-border bg-ds-card/88 shadow-[0_20px_56px_rgba(15,23,42,0.06)] ${
            upgrading ? 'is-upgrading' : ''
          }`}
        >
          {upgrading ? <div className="sdd-editor-progress" /> : null}
          <WriteMarkdownEditor
            value={content}
            workspaceRoot={activeDraft.workspaceRoot}
            filePath={activeDraft.absolutePath ?? activeDraft.relativePath}
            imageDirectory={SDD_IMAGE_RELATIVE_DIR}
            appearance="live"
            livePreviewEnabled
            readOnly={readOnly}
            completionModel={inlineCompletion.model}
            completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
            completionDebounceMs={inlineCompletion.debounceMs}
            completionMinAcceptScore={inlineCompletion.minAcceptScore}
            completionLongEnabled={inlineCompletion.longCompletionEnabled}
            completionLongDebounceMs={inlineCompletion.longDebounceMs}
            completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
            recentEdits={recentEdits}
            onChange={setContent}
            onDocumentEdit={recordRecentEdits}
            onSelectionChange={setSelection}
            onSaveShortcut={() => {
              if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
              void saveActiveSddDraftToDisk()
            }}
            onImagePasteSaved={() => {
              setOperationStatus('idle')
            }}
            onImagePasteError={(message) => setOperationStatus('error', message)}
          />
        </div>
      </div>

      {error ? (
        <div className="sdd-error-toast pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-200/70 bg-red-50/92 px-4 py-2 text-[13px] text-red-700 shadow-[0_14px_32px_rgba(15,23,42,0.12)] dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200">
          {error}
        </div>
      ) : null}
    </section>
  )
}
