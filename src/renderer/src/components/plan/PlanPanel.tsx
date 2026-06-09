import { useEffect, type ReactElement } from 'react'
import {
  ClipboardList,
  ExternalLink,
  Hammer,
  Loader2,
  PanelRightClose,
  Save
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { WriteMarkdownEditor } from '../write/WriteMarkdownEditor'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import {
  guiPlanMatchesContext,
  readRememberedGuiPlan,
  useGuiPlanStore
} from '../../plan/plan-store'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'

type Props = {
  workspaceRoot: string
  activeThreadId: string | null
  runtimeReady: boolean
  busy: boolean
  className?: string
  onCollapse: () => void
  onBuildPlan: () => void
}

function normalizeWorkspaceRoot(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function statusLabelKey(saveStatus: string, operationStatus: string): string {
  if (operationStatus === 'drafting') return 'planStatusDrafting'
  if (operationStatus === 'refining') return 'planStatusRefining'
  if (operationStatus === 'building') return 'planStatusBuilding'
  if (operationStatus === 'error' || saveStatus === 'error') return 'planStatusError'
  if (saveStatus === 'saving') return 'planStatusSaving'
  if (saveStatus === 'dirty') return 'planStatusDirty'
  return 'planStatusSaved'
}

export function PlanPanel({
  workspaceRoot,
  activeThreadId,
  runtimeReady,
  busy,
  className = '',
  onCollapse,
  onBuildPlan
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const {
    activePlan,
    content,
    saveStatus,
    operationStatus,
    error,
    setActivePlan,
    setContent,
    setSaveStatus,
    markSaved,
    setOperationStatus,
    clearActivePlan
  } = useGuiPlanStore(
    useShallow((s) => ({
      activePlan: s.activePlan,
      content: s.content,
      saveStatus: s.saveStatus,
      operationStatus: s.operationStatus,
      error: s.error,
      setActivePlan: s.setActivePlan,
      setContent: s.setContent,
      setSaveStatus: s.setSaveStatus,
      markSaved: s.markSaved,
      setOperationStatus: s.setOperationStatus,
      clearActivePlan: s.clearActivePlan
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
    const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
    if (!normalizedWorkspace) {
      if (activePlan) clearActivePlan()
      return
    }
    if (activePlan && guiPlanMatchesContext(activePlan, normalizedWorkspace, activeThreadId)) return
    const remembered = readRememberedGuiPlan(normalizedWorkspace, activeThreadId)
    if (!remembered) {
      if (activePlan) clearActivePlan()
      return
    }
    let cancelled = false
    setOperationStatus('idle')
    void window.dsGui
      .readWorkspaceFile({
        workspaceRoot: normalizedWorkspace,
        path: remembered.relativePath
      })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setOperationStatus('error', result.message)
          return
        }
        setActivePlan({ ...remembered, absolutePath: result.path }, result.content)
      })
      .catch((loadError) => {
        if (cancelled) return
        setOperationStatus(
          'error',
          loadError instanceof Error ? loadError.message : String(loadError)
        )
      })
    return () => {
      cancelled = true
    }
  }, [
    activePlan,
    activeThreadId,
    clearActivePlan,
    setActivePlan,
    setOperationStatus,
    workspaceRoot
  ])

  useEffect(() => {
    if (!activePlan || saveStatus !== 'dirty') return
    const timer = window.setTimeout(() => {
      const snapshot = useGuiPlanStore.getState()
      if (snapshot.activePlan?.id !== activePlan.id || snapshot.saveStatus !== 'dirty') return
      const contentToSave = snapshot.content
      setSaveStatus('saving')
      void window.dsGui
        .writeWorkspaceFile({
          workspaceRoot: activePlan.workspaceRoot,
          path: activePlan.relativePath,
          content: contentToSave
        })
        .then((result) => {
          const latest = useGuiPlanStore.getState()
          if (latest.activePlan?.id !== activePlan.id) return
          if (!result.ok) {
            setSaveStatus('error', result.message)
            return
          }
          if (latest.content === contentToSave) {
            markSaved(contentToSave)
            if (activeThreadId && runtimeReady) {
              void useChatStore.getState().syncPlanTodosFromMarkdown(activePlan, contentToSave)
            }
          } else {
            setSaveStatus('dirty')
          }
        })
        .catch((saveError) => {
          setSaveStatus('error', saveError instanceof Error ? saveError.message : String(saveError))
        })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [activePlan, activeThreadId, content, markSaved, runtimeReady, saveStatus, setSaveStatus])

  const readOnly =
    operationStatus === 'drafting' ||
    operationStatus === 'refining' ||
    operationStatus === 'building'
  const hasPlan = Boolean(activePlan)
  const canUseAgent = runtimeReady && !busy && hasPlan && !readOnly
  const statusKey = statusLabelKey(saveStatus, operationStatus)

  const openPlanFile = (): void => {
    if (!activePlan) return
    void openWorkspacePathInEditor(
      { path: activePlan.relativePath },
      activePlan.workspaceRoot
    )
  }

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-ds-surface-subtle px-3 py-1.5 dark:bg-white/8">
            <ClipboardList className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
              {activePlan?.featureName || t('planPanelTitle')}
            </span>
          </div>
          <button
            type="button"
            onClick={openPlanFile}
            disabled={!activePlan}
            className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('planOpenFile')}
            title={t('planOpenFile')}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-3">
          <div className="min-w-0 flex-1 truncate rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 py-1.5 text-[11.5px] font-medium text-ds-muted dark:bg-white/6">
            {activePlan?.relativePath ?? t('planNoActiveFile')}
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-card px-2.5 py-1.5 text-[11.5px] font-medium text-ds-muted">
            {saveStatus === 'saving' || operationStatus === 'drafting' || operationStatus === 'refining' || operationStatus === 'building' ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Save className="h-3 w-3" strokeWidth={1.85} />
            )}
            <span>{t(statusKey)}</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-ds-main/45 dark:bg-transparent">
        {!normalizeWorkspaceRoot(workspaceRoot) ? (
          <div className="flex h-full items-center justify-center px-5 text-center text-[13.5px] leading-6 text-ds-muted">
            {t('planNoWorkspace')}
          </div>
        ) : !hasPlan ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <ClipboardList className="h-5 w-5" strokeWidth={1.9} />
            </div>
            <div className="mt-4 text-[16px] font-semibold text-ds-ink">{t('planEmptyTitle')}</div>
            <p className="mt-2 max-w-[22rem] text-[13px] leading-6 text-ds-muted">
              {t('planEmptySub')}
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 min-w-0">
            <div className="min-h-0 min-w-0 flex-1 bg-white dark:bg-ds-canvas">
              <WriteMarkdownEditor
                value={content}
                workspaceRoot={activePlan!.workspaceRoot}
                filePath={activePlan!.absolutePath ?? activePlan!.relativePath}
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
                  const snapshot = useGuiPlanStore.getState()
                  if (snapshot.activePlan?.id === activePlan!.id && snapshot.saveStatus === 'dirty') {
                    setSaveStatus('dirty')
                  }
                }}
                onImagePasteSaved={() => {
                  setOperationStatus('idle')
                }}
                onImagePasteError={(message) => setOperationStatus('error', message)}
              />
            </div>
          </div>
        )}
      </div>

      {hasPlan ? (
        <div className="shrink-0 border-t border-ds-border-muted bg-white/94 p-3 dark:bg-ds-card">
          {error ? (
            <div className="mb-2 rounded-lg border border-red-300/70 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:border-red-800/60 dark:text-red-300">
              {error}
            </div>
          ) : null}
          <p className="mb-2 text-[12px] leading-5 text-ds-muted">{t('planRefineHint')}</p>
          <button
            type="button"
            disabled={!canUseAgent}
            onClick={onBuildPlan}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Hammer className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('planBuild')}
          </button>
        </div>
      ) : null}
    </aside>
  )
}
