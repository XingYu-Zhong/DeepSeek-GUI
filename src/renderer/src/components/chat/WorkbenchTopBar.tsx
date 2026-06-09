import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorInfo } from '@shared/editor'
import type { GuiUpdateState } from '@shared/gui-update'
import {
  ArrowUpCircle,
  Check,
  ChevronDown,
  Code2,
  ClipboardList,
  Download,
  ExternalLink,
  FileEdit,
  FolderOpen,
  Globe2,
  ListTodo,
  Loader2,
  MessageCircleMore,
  RefreshCw,
  Terminal
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readPreferredEditorId, writePreferredEditorId } from '../../lib/editor-preferences'

export type RightPanelMode = 'todo' | 'changes' | 'browser' | 'file' | 'plan' | 'sdd-ai' | null

type Props = {
  rightPanelMode: RightPanelMode
  onToggleRightPanelMode: (mode: Exclude<RightPanelMode, null>) => void
  planPanelEnabled?: boolean
  sideChatCount?: number
  sideChatRunningCount?: number
  sideChatOpen?: boolean
  sideChatEnabled?: boolean
  onOpenSideChat?: () => void
}

export function WorkbenchTopBar({
  rightPanelMode,
  onToggleRightPanelMode,
  planPanelEnabled = false,
  sideChatCount = 0,
  sideChatRunningCount = 0,
  sideChatOpen = false,
  sideChatEnabled = true,
  onOpenSideChat
}: Props): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const [editors, setEditors] = useState<EditorInfo[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState(() => readPreferredEditorId() ?? '')
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(() => new Set())
  const [guiUpdateState, setGuiUpdateState] = useState<GuiUpdateState>({ status: 'idle' })
  const [applyingGuiUpdate, setApplyingGuiUpdate] = useState(false)
  const editorMenuRef = useRef<HTMLDivElement>(null)
  const items = [
    { mode: 'todo' as const, label: t('rightPanelTodo'), icon: ListTodo },
    ...(planPanelEnabled ? [{ mode: 'plan' as const, label: t('rightPanelPlan'), icon: ClipboardList }] : []),
    { mode: 'changes' as const, label: t('rightPanelChanges'), icon: FileEdit },
    { mode: 'browser' as const, label: t('rightPanelBrowser'), icon: Globe2 }
  ]
  const selectedEditor = useMemo(
    () => editors.find((editor) => editor.id === selectedEditorId) ?? editors[0],
    [editors, selectedEditorId]
  )

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui?.listEditors !== 'function') return

    void window.dsGui.listEditors()
      .then((result) => {
        if (cancelled) return
        const available = result.editors.filter((editor) => editor.available)
        const stored = readPreferredEditorId()
        const nextId =
          stored && available.some((editor) => editor.id === stored)
            ? stored
            : result.defaultEditorId
        setEditors(available)
        setSelectedEditorId(nextId)
        writePreferredEditorId(nextId)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!editorMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editorMenuRef.current?.contains(target)) return
      setEditorMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [editorMenuOpen])

  useEffect(() => {
    if (typeof window.dsGui?.onGuiUpdateState !== 'function') return
    const applyState = (state: GuiUpdateState): void => {
      setGuiUpdateState(state)
    }
    const unsubscribe = window.dsGui.onGuiUpdateState(applyState)
    if (typeof window.dsGui?.getGuiUpdateState === 'function') {
      void window.dsGui.getGuiUpdateState().then(applyState).catch(() => undefined)
    }
    return unsubscribe
  }, [])

  const guiUpdateAction = useMemo(() => {
    if (guiUpdateState.status === 'available' || guiUpdateState.status === 'downloaded') {
      return guiUpdateState.info.hasUpdate ? guiUpdateState.info : null
    }
    if (guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing') {
      return guiUpdateState.info?.hasUpdate ? guiUpdateState.info : null
    }
    if (guiUpdateState.status === 'error' && guiUpdateState.info?.ok && guiUpdateState.info.hasUpdate) {
      return guiUpdateState.info
    }
    return null
  }, [guiUpdateState])
  const guiUpdateBusy =
    applyingGuiUpdate || guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing'
  const guiUpdateLabel = useMemo(() => {
    if (!guiUpdateAction) return ''
    if (guiUpdateState.status === 'downloading') {
      return t('guiUpdateTopbarDownloading', {
        percent: Math.max(0, Math.round(guiUpdateState.progress.percent))
      })
    }
    if (guiUpdateState.status === 'installing') {
      return t('guiUpdateTopbarInstalling')
    }
    if (guiUpdateAction.downloaded || guiUpdateState.status === 'downloaded') {
      return t('settings:guiUpdateInstall')
    }
    if (guiUpdateAction.manualOnly) {
      return t('guiUpdateTopbarManual', { version: guiUpdateAction.latestVersion })
    }
    return t('guiUpdateTopbarAvailable', { version: guiUpdateAction.latestVersion })
  }, [guiUpdateAction, guiUpdateState, t])
  const guiUpdateTitle = useMemo(() => {
    if (!guiUpdateAction) return ''
    return guiUpdateAction.manualOnly
      ? t('settings:guiUpdateAvailableManual', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
      : t('settings:guiUpdateAvailable', {
          current: guiUpdateAction.currentVersion,
          latest: guiUpdateAction.latestVersion
        })
  }, [guiUpdateAction, t])

  const chooseEditor = (editor: EditorInfo): void => {
    setSelectedEditorId(editor.id)
    writePreferredEditorId(editor.id)
    setEditorMenuOpen(false)
  }

  const markEditorIconFailed = (editorId: string): void => {
    setFailedIconIds((prev) => {
      if (prev.has(editorId)) return prev
      const next = new Set(prev)
      next.add(editorId)
      return next
    })
  }

  const renderEditorIcon = (editor: EditorInfo | null | undefined, className: string): ReactElement => {
    const Icon =
      editor?.kind === 'terminal' ? Terminal : editor?.kind === 'viewer' ? FolderOpen : Code2

    if (editor?.iconDataUrl && !failedIconIds.has(editor.id)) {
      return (
        <img
          src={editor.iconDataUrl}
          alt=""
          aria-hidden="true"
          className={`${className} shrink-0 rounded-[4px] object-contain`}
          onError={() => markEditorIconFailed(editor.id)}
        />
      )
    }

    return <Icon className={`${className} shrink-0`} strokeWidth={1.8} />
  }

  const runGuiUpdateAction = async (): Promise<void> => {
    if (!guiUpdateAction || guiUpdateBusy) return
    if (guiUpdateAction.manualOnly) {
      if (typeof window.dsGui?.openExternal === 'function') {
        await window.dsGui.openExternal(guiUpdateAction.releaseUrl)
      }
      return
    }
    if (
      typeof window.dsGui?.downloadGuiUpdate !== 'function' ||
      typeof window.dsGui?.installGuiUpdate !== 'function'
    ) {
      return
    }

    setApplyingGuiUpdate(true)
    try {
      if (!guiUpdateAction.downloaded && guiUpdateState.status !== 'downloaded') {
        const downloadResult = await window.dsGui.downloadGuiUpdate(guiUpdateAction.channel)
        if (!downloadResult.ok) return
      }
      const installResult = await window.dsGui.installGuiUpdate()
      if (!installResult.ok && typeof window.dsGui?.logError === 'function') {
        await window.dsGui.logError('gui-update', 'Failed to install GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message: installResult.message
        })
      }
    } catch (error) {
      if (typeof window.dsGui?.logError === 'function') {
        await window.dsGui.logError('gui-update', 'Failed to apply GUI update from workbench top bar', {
          version: guiUpdateAction.latestVersion,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      setApplyingGuiUpdate(false)
    }
  }

  const renderGuiUpdateIcon = (): ReactElement => {
    if (guiUpdateState.status === 'downloading' || guiUpdateState.status === 'installing' || applyingGuiUpdate) {
      return <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
    }
    if (guiUpdateAction?.downloaded || guiUpdateState.status === 'downloaded') {
      return <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.85} />
    }
    if (guiUpdateAction?.manualOnly) {
      return <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.85} />
    }
    if (guiUpdateAction) {
      return <ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={1.85} />
    }
    return <Download className="h-3.5 w-3.5" strokeWidth={1.85} />
  }

  return (
    <div className="chat-workbench-topbar ds-no-drag flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-1">
      {guiUpdateAction ? (
        <button
          type="button"
          onClick={() => void runGuiUpdateAction()}
          disabled={guiUpdateBusy}
          className="chat-gui-update-button inline-flex items-center gap-1.5 rounded-full border border-amber-300/75 bg-amber-50/92 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/70 dark:bg-amber-950/35 dark:text-amber-100 dark:hover:bg-amber-900/45"
          aria-label={guiUpdateTitle}
          title={guiUpdateTitle}
        >
          {renderGuiUpdateIcon()}
          <span className="chat-gui-update-label max-w-[11rem] truncate">{guiUpdateLabel}</span>
        </button>
      ) : null}

      <div ref={editorMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setEditorMenuOpen((value) => !value)}
          className="inline-flex items-center gap-1 rounded-full border border-transparent bg-white/38 px-2.5 py-1.5 text-ds-faint opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:bg-white/8"
          aria-label={t('editorPickerTitle')}
          aria-expanded={editorMenuOpen}
          title={
            selectedEditor
              ? t('editorPickerTitleWithEditor', { editor: selectedEditor.label })
              : t('editorPickerTitle')
          }
        >
          {renderEditorIcon(selectedEditor, 'h-4 w-4')}
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.9} />
        </button>

        {editorMenuOpen ? (
          <div className="ds-card-strong absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[18px] border border-ds-border py-1.5 shadow-[0_18px_52px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]">
            <div className="border-b border-ds-border-muted px-3 pb-2 pt-1.5 text-[11px] font-semibold text-ds-faint">
              {t('editorPickerMenuTitle')}
            </div>
            {editors.map((editor) => {
              const active = editor.id === selectedEditor?.id
              return (
                <button
                  key={editor.id}
                  type="button"
                  onClick={() => chooseEditor(editor)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] transition ${
                    active
                      ? 'bg-ds-hover text-ds-ink'
                      : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
                  }`}
                >
                  {renderEditorIcon(editor, 'h-4 w-4')}
                  <span className="min-w-0 flex-1 truncate">{editor.label}</span>
                  {editor.supportsLine ? (
                    <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      {t('editorLineBadge')}
                    </span>
                  ) : null}
                  {active ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {onOpenSideChat ? (
        <button
          type="button"
          onClick={onOpenSideChat}
          disabled={!sideChatEnabled}
          className={`relative rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition disabled:cursor-not-allowed disabled:opacity-45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
            sideChatOpen
              ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
              : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
          }`}
          aria-label={t('sidePanelOpen')}
          aria-pressed={sideChatOpen}
          title={t('sidePanelOpen')}
        >
          <MessageCircleMore className="h-4 w-4" strokeWidth={1.75} />
          {sideChatCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {Math.min(sideChatCount, 9)}
            </span>
          ) : null}
          {sideChatRunningCount > 0 ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.18)]" />
          ) : null}
        </button>
      ) : null}

      {items.map((item) => {
        const active = rightPanelMode === item.mode
        const Icon = item.icon
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => onToggleRightPanelMode(item.mode)}
            className={`rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
              active
                ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
                : 'border-transparent bg-white/38 text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:hover:bg-white/8'
            }`}
            aria-label={item.label}
            aria-pressed={active}
            title={item.label}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )
      })}
    </div>
  )
}
