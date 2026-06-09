import type { FormEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderOpen,
  GitFork,
  Loader2,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot
} from '../../lib/workspace-path'
import {
  SidebarIconButton,
  SidebarSearchField,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'

type SidebarProjectsSectionProps = {
  threads: NormalizedThread[]
  activeView: 'chat' | 'write' | 'claw'
  activeThreadId: string | null
  runtimeReady: boolean
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  workspaceRoots: string[]
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  locale: string
  onPickWorkspace: () => void
  onRemoveWorkspace: (workspacePath: string) => Promise<void>
  onCreateThreadInWorkspace: (workspacePath: string) => void
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => Promise<void>
  onArchiveThread: (threadId: string) => Promise<void>
  onDeleteThread: (threadId: string) => Promise<void>
  onRestoreThread: (threadId: string) => Promise<void>
  onSearchQueryChange: (query: string) => void
  onShowArchivedChange: (show: boolean) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

export type SidebarWorkspaceGroup = [workspacePath: string, threads: NormalizedThread[]]

type ThreadContextMenuState = {
  thread: NormalizedThread
  x: number
  y: number
}

export type RenameThreadDialogState = {
  thread: NormalizedThread
  value: string
  submitting: boolean
}

export function buildSidebarWorkspaceGroups(options: {
  threads: NormalizedThread[]
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  workspaceRoots: string[]
}): SidebarWorkspaceGroup[] {
  const map = new Map<string, NormalizedThread[]>()
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  const query = options.searchQuery.trim().toLowerCase()

  for (const th of options.threads) {
    if (isInternalTemporaryWorkspace(th.workspace)) continue
    if (isInternalDeepSeekGuiWorkspace(th.workspace)) continue
    if (isClawWorkspacePath(th.workspace)) continue
    if ((th.archived === true) !== options.showArchived) continue
    const key = normalizeWorkspaceRoot(th.workspace)
    if (!key) continue
    if (query) {
      const haystack = [th.title, th.preview, key, workspaceLabelFromPath(key)]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      if (!haystack.includes(query)) continue
    }
    const arr = map.get(key) ?? []
    arr.push(th)
    map.set(key, arr)
  }

  if (selectedWorkspace && !map.has(selectedWorkspace)) {
    map.set(selectedWorkspace, [])
  }
  if (!query && !options.showArchived) {
    for (const workspacePath of options.workspaceRoots) {
      const key = normalizeWorkspaceRoot(workspacePath)
      if (!key || map.has(key)) continue
      if (isInternalTemporaryWorkspace(key)) continue
      if (isInternalDeepSeekGuiWorkspace(key)) continue
      if (isClawWorkspacePath(key)) continue
      map.set(key, [])
    }
  }

  return Array.from(map.entries()).sort(([a], [b]) => {
    if (a === selectedWorkspace && b !== selectedWorkspace) return -1
    if (b === selectedWorkspace && a !== selectedWorkspace) return 1
    return a.localeCompare(b)
  })
}

export function SidebarProjectsSection({
  threads,
  activeView,
  activeThreadId,
  runtimeReady,
  searchQuery,
  showArchived,
  workspaceRoot,
  workspaceRoots,
  busy,
  watchTurnCompletion,
  unreadThreadIds,
  locale,
  onPickWorkspace,
  onRemoveWorkspace,
  onCreateThreadInWorkspace,
  onSelectThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onSearchQueryChange,
  onShowArchivedChange,
  t
}: SidebarProjectsSectionProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({})
  const [deletingThreadIds, setDeletingThreadIds] = useState<Record<string, boolean>>({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [threadContextMenu, setThreadContextMenu] = useState<ThreadContextMenuState | null>(null)
  const [renameThreadDialog, setRenameThreadDialog] = useState<RenameThreadDialogState | null>(null)

  const groups = useMemo(() => {
    return buildSidebarWorkspaceGroups({
      threads,
      searchQuery,
      showArchived,
      workspaceRoot,
      workspaceRoots
    })
  }, [searchQuery, showArchived, threads, workspaceRoot, workspaceRoots])

  const searchVisible = searchOpen || searchQuery.trim().length > 0
  const allGroupsCollapsed = groups.length > 0 && groups.every(([workspacePath]) => collapsed[workspacePath] === true)

  useEffect(() => {
    if (!threadContextMenu) return
    const close = (): void => setThreadContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [threadContextMenu])

  const toggleAllGroups = (): void => {
    if (groups.length === 0) return
    if (allGroupsCollapsed) {
      setCollapsed({})
      return
    }
    setCollapsed(Object.fromEntries(groups.map(([workspacePath]) => [workspacePath, true])))
  }

  const handleDeleteThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    const confirmMessage = t('sidebarThreadDeleteConfirm', { title: thread.title })
    if (!window.confirm(confirmMessage)) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onDeleteThread(threadId)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const handleArchiveThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    const confirmMessage = t('sidebarThreadArchiveConfirm', { title: thread.title })
    if (!window.confirm(confirmMessage)) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onArchiveThread(threadId)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const handleRestoreThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onRestoreThread(threadId)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const openRenameThreadDialog = (thread: NormalizedThread): void => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setRenameThreadDialog({
      thread,
      value: thread.title,
      submitting: false
    })
  }

  const closeRenameThreadDialog = (): void => {
    setRenameThreadDialog((current) => current?.submitting ? current : null)
  }

  const submitRenameThreadDialog = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const dialog = renameThreadDialog
    if (!dialog || dialog.submitting) return
    const threadId = dialog.thread.id.trim()
    const nextTitle = dialog.value.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    if (!nextTitle) return
    if (nextTitle === dialog.thread.title) {
      setRenameThreadDialog(null)
      return
    }
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    setRenameThreadDialog((current) =>
      current?.thread.id === threadId ? { ...current, value: nextTitle, submitting: true } : current
    )
    try {
      await onRenameThread(threadId, nextTitle)
      setRenameThreadDialog(null)
    } catch {
      setRenameThreadDialog((current) =>
        current?.thread.id === threadId ? { ...current, submitting: false } : current
      )
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const openThreadContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    thread: NormalizedThread
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    setThreadContextMenu({
      thread,
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 150)
    })
  }

  const handleRemoveWorkspace = async (workspacePath: string): Promise<void> => {
    const confirmMessage = t('sidebarWorkspaceRemoveConfirm', { path: workspacePath })
    if (!window.confirm(confirmMessage)) return
    await onRemoveWorkspace(workspacePath)
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[38px] items-center justify-between px-2 pb-1.5 pt-3">
        <button
          type="button"
          onClick={toggleAllGroups}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
          title={t('sidebarProjects')}
          aria-label={t('sidebarProjects')}
        >
          <span className="truncate">{t('sidebarProjects')}</span>
          {allGroupsCollapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <SidebarIconButton
            onClick={() => setSearchOpen((open) => !open)}
            active={searchVisible}
            className="h-7 w-7"
            title={t('sidebarSearchThreads')}
            ariaLabel={t('sidebarSearchThreads')}
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
          </SidebarIconButton>
          <SidebarIconButton
            onClick={() => onShowArchivedChange(!showArchived)}
            active={showArchived}
            className="h-7 w-7"
            title={showArchived ? t('sidebarShowActiveThreads') : t('sidebarShowArchivedThreads')}
            ariaLabel={showArchived ? t('sidebarShowActiveThreads') : t('sidebarShowArchivedThreads')}
          >
            <Archive className="h-3.5 w-3.5" strokeWidth={1.85} />
          </SidebarIconButton>
          <SidebarIconButton
            onClick={onPickWorkspace}
            className="h-7 w-7"
            title={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
            ariaLabel={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
          >
            <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </SidebarIconButton>
        </div>
      </div>

      {searchVisible ? (
        <div className="mb-2 flex items-center gap-1 px-2">
          <SidebarSearchField
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t('sidebarSearchThreads')}
            clearLabel={t('clear')}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-0.5">
        {groups.length === 0 ? (
          <SidebarEmpty
            runtimeReady={runtimeReady}
            hasWorkspace={!!workspaceRoot}
            onPickWorkspace={onPickWorkspace}
            t={t}
          />
        ) : null}

        {groups.map(([workspacePath, list]) => {
          const folderName = workspaceLabelFromPath(workspacePath)
          const workspaceContext = workspaceContextLabel(workspacePath, folderName)
          const isCollapsed = collapsed[workspacePath] === true
          const sortedThreads = [...list].sort(
            (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
          )
          const workspaceExpanded = expandedWorkspaces[workspacePath] === true
          const hasOverflow = sortedThreads.length > 5
          const visibleThreads = workspaceExpanded
            ? sortedThreads
            : sortedThreads.slice(0, 5)
          return (
            <div key={workspacePath} className="mb-2">
              <SidebarTreeRow
                title={workspacePath}
                onClick={() =>
                  setCollapsed((current) => ({ ...current, [workspacePath]: !current[workspacePath] }))
                }
                className="min-h-[36px] text-[13.5px]"
                buttonClassName="items-center gap-2 px-2.5 py-2"
                actionsVisibility="hidden"
                actionsLayout="overlay"
                actions={
                  <>
                    <SidebarIconButton
                      onClick={() => onCreateThreadInWorkspace(workspacePath)}
                      title={t('sidebarWorkspaceNewThread')}
                      ariaLabel={t('sidebarWorkspaceNewThread')}
                      className="h-6 w-6"
                      stopPropagation
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </SidebarIconButton>
                    <SidebarIconButton
                      onClick={() => void handleRemoveWorkspace(workspacePath)}
                      title={t('sidebarWorkspaceRemove')}
                      ariaLabel={t('sidebarWorkspaceRemove')}
                      tone="danger"
                      className="h-6 w-6"
                      stopPropagation
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </SidebarIconButton>
                  </>
                }
              >
                {isCollapsed ? (
                  <Folder className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                ) : (
                  <FolderOpen className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                )}
                <span className="min-w-0 flex-1 truncate">{folderName}</span>
                {workspaceContext ? (
                  <span className="min-w-0 max-w-[42%] shrink truncate text-[12.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                    {workspaceContext}
                  </span>
                ) : null}
              </SidebarTreeRow>

              {!isCollapsed ? (
                <div className="mt-1 space-y-[3px] pl-4">
                  {sortedThreads.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                      <div className="text-[12.5px] leading-5 text-ds-faint">
                        {searchQuery.trim()
                          ? t('sidebarSearchEmpty')
                          : showArchived
                            ? t('sidebarArchiveEmpty')
                            : t('sidebarWorkspaceEmpty')}
                      </div>
                      {!showArchived && !searchQuery.trim() ? (
                        <button
                          type="button"
                          onClick={() => onCreateThreadInWorkspace(workspacePath)}
                          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                        >
                          {t('sidebarWorkspaceNewThread')}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    visibleThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        active={(activeView === 'chat' || activeView === 'write') && activeThreadId === thread.id}
                        deleting={deletingThreadIds[thread.id] === true}
                        locale={locale}
                        showRunning={
                          thread.status?.trim().toLowerCase() === 'running' ||
                          (activeThreadId === thread.id && busy) ||
                          watchTurnCompletion[thread.id] === true
                        }
                        showUnread={
                          unreadThreadIds[thread.id] === true && activeThreadId !== thread.id
                        }
                        onSelect={() => onSelectThread(thread.id)}
                        onContextMenu={(event) => openThreadContextMenu(event, thread)}
                        onRename={() => openRenameThreadDialog(thread)}
                        onArchive={() => void handleArchiveThread(thread)}
                        onDelete={() => void handleDeleteThread(thread)}
                        onRestore={() => void handleRestoreThread(thread)}
                      />
                    ))
                  )}
                  {hasOverflow ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedWorkspaces((current) => ({
                          ...current,
                          [workspacePath]: !workspaceExpanded
                        }))
                      }
                      className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                    >
                      {workspaceExpanded
                        ? t('sidebarWorkspaceShowLess')
                        : t('sidebarWorkspaceShowMore', {
                            count: sortedThreads.length - 5
                          })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {threadContextMenu ? (
        <ThreadContextMenu
          state={threadContextMenu}
          busy={deletingThreadIds[threadContextMenu.thread.id] === true}
          onClose={() => setThreadContextMenu(null)}
          onRename={() => openRenameThreadDialog(threadContextMenu.thread)}
          onArchive={() => void handleArchiveThread(threadContextMenu.thread)}
          onDelete={() => void handleDeleteThread(threadContextMenu.thread)}
          onRestore={() => void handleRestoreThread(threadContextMenu.thread)}
          t={t}
        />
      ) : null}

      {renameThreadDialog ? (
        <ThreadRenameDialog
          state={renameThreadDialog}
          onClose={closeRenameThreadDialog}
          onValueChange={(value) =>
            setRenameThreadDialog((current) => current ? { ...current, value } : current)
          }
          onSubmit={(event) => void submitRenameThreadDialog(event)}
          t={t}
        />
      ) : null}
    </div>
  )
}

type ThreadRowProps = {
  thread: NormalizedThread
  active: boolean
  deleting: boolean
  locale: string
  showRunning: boolean
  showUnread: boolean
  onSelect: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
}

function ThreadRow({
  thread,
  active,
  deleting,
  locale,
  showRunning,
  showUnread,
  onSelect,
  onContextMenu,
  onRename,
  onArchive,
  onDelete,
  onRestore
}: ThreadRowProps): ReactElement {
  const { t } = useTranslation('common')
  const showUnreadDot = showUnread && !showRunning
  const archived = thread.archived === true
  const forkedFromTitle = thread.forkedFromTitle?.trim() ?? ''
  const forked = Boolean(thread.forkedFromThreadId)
  const forkLabel = forked
    ? forkedFromTitle
      ? t('sidebarThreadForkedFrom', { title: forkedFromTitle })
      : t('sidebarThreadForked')
    : ''
  const updatedLabel = formatRelativeTime(thread.updatedAt, locale)
  const ariaLabel = [
    thread.title,
    updatedLabel,
    showRunning ? t('sidebarThreadRunning') : '',
    showUnreadDot ? t('sidebarThreadUnread') : '',
    forkLabel
  ].filter(Boolean).join(' — ')

  return (
    <SidebarTreeRow
      active={active}
      actionsVisibility={deleting ? 'visible' : 'hidden'}
      actionsLayout="overlay"
      actions={
        <>
          <SidebarIconButton
            onClick={archived ? onRestore : onArchive}
            disabled={deleting}
            tone="accent"
            title={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
            ariaLabel={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
            stopPropagation
          >
            {deleting ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : archived ? (
              <RotateCcw className="h-3 w-3" strokeWidth={1.9} />
            ) : (
              <Archive className="h-3 w-3" strokeWidth={1.9} />
            )}
          </SidebarIconButton>
          <SidebarIconButton
            onClick={onDelete}
            disabled={deleting}
            tone="danger"
            title={t('sidebarThreadDelete')}
            ariaLabel={t('sidebarThreadDelete')}
            stopPropagation
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.9} />
          </SidebarIconButton>
        </>
      }
      className="min-h-[34px]"
      buttonClassName="items-center gap-2 px-2.5 py-1.5"
      disabled={deleting}
      ariaLabel={ariaLabel}
      title={forkLabel ? `${thread.title}\n${forkLabel}` : thread.title}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {forked ? (
        <GitFork
          className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-faint/90'}`}
          strokeWidth={1.8}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] leading-5 ${
            showUnreadDot && !active ? 'font-semibold text-ds-ink' : 'text-ds-ink'
          }`}
        >
          {thread.title}
        </span>
        {forked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/15 bg-accent/8 px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-accent">
            <GitFork className="h-2.5 w-2.5" strokeWidth={1.8} />
            {t('sidebarThreadForkBadge')}
          </span>
        ) : null}
        <span
          className={`ml-auto flex shrink-0 items-center gap-1.5 transition ${
            deleting ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0'
          }`}
        >
          <span className="shrink-0 text-right text-[12px] leading-4 text-ds-faint tabular-nums">
            {updatedLabel}
          </span>
          <ThreadActivityDot
            running={showRunning}
            unread={showUnreadDot}
            unreadLabel={t('sidebarThreadUnread')}
          />
        </span>
      </span>
    </SidebarTreeRow>
  )
}

export function ThreadRenameDialog({
  state,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  state: RenameThreadDialogState
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const nextTitle = state.value.trim()
  const unchanged = nextTitle === state.thread.title
  const canSubmit = Boolean(nextTitle) && !unchanged && !state.submitting

  useEffect(() => {
    if (state.submitting) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, state.submitting])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="thread-rename-dialog-title"
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
      >
        <h2
          id="thread-rename-dialog-title"
          className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink"
        >
          {t('sidebarThreadRename')}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {t('sidebarThreadRenamePrompt')}
        </p>
        <input
          autoFocus
          aria-label={t('sidebarThreadRenamePrompt')}
          disabled={state.submitting}
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:cursor-wait disabled:opacity-70"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {state.submitting ? t('loading') : t('confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}

function ThreadContextMenu({
  state,
  busy,
  onClose,
  onRename,
  onArchive,
  onDelete,
  onRestore,
  t
}: {
  state: ThreadContextMenuState
  busy: boolean
  onClose: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const archived = state.thread.archived === true
  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <div
      role="menu"
      aria-label={state.thread.title}
      className="ds-thread-context-menu ds-no-drag fixed z-50 min-w-[168px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_16px_42px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ThreadContextMenuItem
        icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarThreadRename')}
        disabled={busy}
        onClick={() => run(onRename)}
      />
      <ThreadContextMenuItem
        icon={
          archived
            ? <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} />
            : <Archive className="h-3.5 w-3.5" strokeWidth={1.9} />
        }
        label={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
        disabled={busy}
        onClick={() => run(archived ? onRestore : onArchive)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <ThreadContextMenuItem
        icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarThreadDelete')}
        disabled={busy}
        danger
        onClick={() => run(onDelete)}
      />
    </div>
  )
}

function ThreadContextMenuItem({
  icon,
  label,
  disabled,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled: boolean
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300'
          : 'text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function workspaceContextLabel(workspacePath: string, folderName: string): string {
  const normalized = workspacePath.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  if (!parent || parent.toLowerCase() === folderName.toLowerCase()) return ''
  return parent
}

function ThreadActivityDot({
  running,
  unread,
  unreadLabel
}: {
  running: boolean
  unread: boolean
  unreadLabel: string
}): ReactElement | null {
  if (running) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />
  }

  if (unread) {
    return (
      <span
        className="block h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_1px_rgba(79,124,255,0.2)]"
        title={unreadLabel}
      />
    )
  }

  return null
}

type SidebarEmptyProps = {
  runtimeReady: boolean
  hasWorkspace: boolean
  onPickWorkspace: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

function SidebarEmpty({
  runtimeReady,
  hasWorkspace,
  onPickWorkspace,
  t
}: SidebarEmptyProps): ReactElement {
  if (!hasWorkspace && runtimeReady) {
    return (
      <button
        type="button"
        onClick={onPickWorkspace}
        className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
      >
        <FolderPlus className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {t('selectWorkspace')}
        </span>
      </button>
    )
  }

  return (
    <div className="mx-2 mt-2 rounded-lg px-2 py-2">
      <p className="text-[15px] font-medium text-ds-muted">{t('sidebarEmptyTitle')}</p>
      <p className="mt-1 text-[13px] leading-5 text-ds-faint">
        {runtimeReady ? t('sidebarEmptySub') : t('sidebarEmptySubOffline')}
      </p>
    </div>
  )
}
