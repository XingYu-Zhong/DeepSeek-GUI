import type { FormEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ClipboardList,
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
import { confirmDialog } from '../../lib/confirm-dialog'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { deleteSddDraft } from '../../sdd/sdd-draft-actions'
import { listSddDraftHistory, type SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import { useSddDraftStore, type SddDraft } from '../../sdd/sdd-draft-store'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
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
  onOpenRequirementDraft: (draft: SddDraft) => void
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

const SDD_DRAFT_HISTORY_PAGE_SIZE = 3
const SDD_DRAFT_HISTORY_LOAD_LIMIT = 40

function isSidebarProjectWorkspacePath(workspacePath: string): boolean {
  const normalized = normalizeWorkspaceRoot(workspacePath)
  if (!normalized) return false
  if (isInternalTemporaryWorkspace(normalized)) return false
  if (isInternalDeepSeekGuiWorkspace(normalized)) return false
  if (isClawWorkspacePath(normalized)) return false
  return true
}

function compareWorkspacePathsByActive(a: string, b: string, selectedWorkspace: string): number {
  const selectedWorkspaceKey = workspaceRootIdentityKey(selectedWorkspace)
  const aKey = workspaceRootIdentityKey(a)
  const bKey = workspaceRootIdentityKey(b)
  if (aKey === selectedWorkspaceKey && bKey !== selectedWorkspaceKey) return -1
  if (bKey === selectedWorkspaceKey && aKey !== selectedWorkspaceKey) return 1
  return a.localeCompare(b)
}

function sortWorkspacePathsByActive(workspacePaths: string[], selectedWorkspace: string): string[] {
  return [...workspacePaths].sort((a, b) => compareWorkspacePathsByActive(a, b, selectedWorkspace))
}

export function buildSidebarWorkspaceGroups(options: {
  threads: NormalizedThread[]
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  workspaceRoots: string[]
}): SidebarWorkspaceGroup[] {
  const map = new Map<string, { workspacePath: string, threads: NormalizedThread[] }>()
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  const selectedWorkspaceKey = workspaceRootIdentityKey(selectedWorkspace)
  const query = options.searchQuery.trim().toLowerCase()

  const upsertWorkspace = (workspacePath: string, threads: NormalizedThread[] = []): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const existing = map.get(key)
    if (existing) {
      existing.threads.push(...threads)
      if (key === selectedWorkspaceKey && normalized === selectedWorkspace) {
        existing.workspacePath = normalized
      }
      return
    }
    map.set(key, { workspacePath: normalized, threads: [...threads] })
  }

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
    upsertWorkspace(key, [th])
  }

  if (selectedWorkspace && !map.has(selectedWorkspaceKey)) {
    upsertWorkspace(selectedWorkspace)
  }
  if (!query && !options.showArchived) {
    for (const workspacePath of options.workspaceRoots) {
      const key = normalizeWorkspaceRoot(workspacePath)
      if (!key || map.has(workspaceRootIdentityKey(key))) continue
      if (isInternalTemporaryWorkspace(key)) continue
      if (isInternalDeepSeekGuiWorkspace(key)) continue
      if (isClawWorkspacePath(key)) continue
      upsertWorkspace(key)
    }
  }

  return Array.from(map.values()).map(({ workspacePath, threads }): SidebarWorkspaceGroup => [workspacePath, threads]).sort(([a], [b]) => {
    const aKey = workspaceRootIdentityKey(a)
    const bKey = workspaceRootIdentityKey(b)
    if (aKey === selectedWorkspaceKey && bKey !== selectedWorkspaceKey) return -1
    if (bKey === selectedWorkspaceKey && aKey !== selectedWorkspaceKey) return 1
    return a.localeCompare(b)
  })
}

export function buildSidebarDraftWorkspacePaths(options: {
  threads: NormalizedThread[]
  workspaceRoot: string
  workspaceRoots: string[]
}): string[] {
  const map = new Map<string, string>()
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)

  const upsertWorkspace = (workspacePath: string): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (!isSidebarProjectWorkspacePath(normalized)) return
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const previous = map.get(key)
    if (!previous || normalized === selectedWorkspace) {
      map.set(key, normalized)
    }
  }

  upsertWorkspace(selectedWorkspace)
  for (const workspacePath of options.workspaceRoots) {
    upsertWorkspace(workspacePath)
  }
  for (const thread of options.threads) {
    upsertWorkspace(thread.workspace ?? '')
  }

  return sortWorkspacePathsByActive([...map.values()], selectedWorkspace)
}

export function filterSddDraftHistoryItems(
  items: SddDraftHistoryItem[],
  searchQuery: string,
  workspacePath = ''
): SddDraftHistoryItem[] {
  const query = searchQuery.trim().toLowerCase()
  if (!query) return items
  const workspaceLabel = workspacePath ? workspaceLabelFromPath(workspacePath) : ''
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.relativePath,
      item.absolutePath,
      item.searchText,
      workspacePath,
      workspaceLabel
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
    return haystack.includes(query)
  })
}

export function mergeSidebarWorkspaceGroupsWithDraftHistory(options: {
  groups: SidebarWorkspaceGroup[]
  draftHistoryByWorkspace: Record<string, SddDraftHistoryItem[]>
  workspaceRoot: string
}): SidebarWorkspaceGroup[] {
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  const map = new Map<string, SidebarWorkspaceGroup>()

  const upsertGroup = (workspacePath: string, threads: NormalizedThread[] = []): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (!isSidebarProjectWorkspacePath(normalized)) return
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const previous = map.get(key)
    if (previous) {
      previous[1].push(...threads)
      if (normalized === selectedWorkspace) previous[0] = normalized
      return
    }
    map.set(key, [normalized, [...threads]])
  }

  for (const [workspacePath, threads] of options.groups) {
    upsertGroup(workspacePath, threads)
  }
  for (const [workspacePath, items] of Object.entries(options.draftHistoryByWorkspace)) {
    if (items.length > 0) upsertGroup(workspacePath)
  }

  return Array.from(map.values()).sort(([a], [b]) => compareWorkspacePathsByActive(a, b, selectedWorkspace))
}

function sddDraftHistoryForWorkspace(
  draftHistoryByWorkspace: Record<string, SddDraftHistoryItem[]>,
  workspacePath: string
): SddDraftHistoryItem[] {
  const exact = draftHistoryByWorkspace[workspacePath]
  if (exact) return exact
  const targetKey = workspaceRootIdentityKey(workspacePath)
  if (!targetKey) return []
  for (const [path, history] of Object.entries(draftHistoryByWorkspace)) {
    if (workspaceRootIdentityKey(path) === targetKey) return history
  }
  return []
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
  onOpenRequirementDraft,
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
  const [deletingDraftIds, setDeletingDraftIds] = useState<Record<string, boolean>>({})
  const [draftHistoryErrors, setDraftHistoryErrors] = useState<Record<string, string>>({})
  const [draftHistoryRefreshVersion, setDraftHistoryRefreshVersion] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [threadContextMenu, setThreadContextMenu] = useState<ThreadContextMenuState | null>(null)
  const [renameThreadDialog, setRenameThreadDialog] = useState<RenameThreadDialogState | null>(null)
  const [draftHistoryByWorkspace, setDraftHistoryByWorkspace] = useState<Record<string, SddDraftHistoryItem[]>>({})
  const activeSddDraftId = useSddDraftStore((s) => s.activeDraft?.id ?? '')

  const groups = useMemo(() => {
    return buildSidebarWorkspaceGroups({
      threads,
      searchQuery,
      showArchived,
      workspaceRoot,
      workspaceRoots
    })
  }, [searchQuery, showArchived, threads, workspaceRoot, workspaceRoots])

  const draftHistoryWorkspacePaths = useMemo(() => {
    return buildSidebarDraftWorkspacePaths({
      threads,
      workspaceRoot,
      workspaceRoots
    })
  }, [threads, workspaceRoot, workspaceRoots])

  const filteredDraftHistoryByWorkspace = useMemo(() => {
    return Object.fromEntries(
      Object.entries(draftHistoryByWorkspace)
        .map(([path, history]) => [
          path,
          filterSddDraftHistoryItems(history, searchQuery, path)
        ] as const)
        .filter(([, history]) => history.length > 0)
    )
  }, [draftHistoryByWorkspace, searchQuery])

  const displayGroups = useMemo(() => {
    return mergeSidebarWorkspaceGroupsWithDraftHistory({
      groups,
      draftHistoryByWorkspace: filteredDraftHistoryByWorkspace,
      workspaceRoot
    })
  }, [filteredDraftHistoryByWorkspace, groups, workspaceRoot])

  const searchVisible = searchOpen || searchQuery.trim().length > 0
  const allGroupsCollapsed = displayGroups.length > 0 && displayGroups.every(([workspacePath]) => collapsed[workspacePath] === true)
  const workspaceHistoryKey = draftHistoryWorkspacePaths.join('\n')

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.kunGui?.listWorkspaceDirectory !== 'function' ||
      typeof window.kunGui?.readWorkspaceFile !== 'function'
    ) {
      setDraftHistoryByWorkspace({})
      return
    }
    const workspacePaths = workspaceHistoryKey.split('\n').filter(Boolean)
    if (workspacePaths.length === 0) {
      setDraftHistoryByWorkspace({})
      return
    }
    let cancelled = false
    void Promise.all(
      workspacePaths.map(async (path) => {
        const history = await listSddDraftHistory({
          workspaceRoot: path,
          listWorkspaceDirectory: window.kunGui.listWorkspaceDirectory,
          readWorkspaceFile: window.kunGui.readWorkspaceFile,
          limit: SDD_DRAFT_HISTORY_LOAD_LIMIT
        }).catch(() => [])
        return [path, history] as const
      })
    ).then((entries) => {
      if (cancelled) return
      setDraftHistoryByWorkspace(Object.fromEntries(entries.filter(([, history]) => history.length > 0)))
    })
    return () => {
      cancelled = true
    }
  }, [draftHistoryRefreshVersion, workspaceHistoryKey])

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
    if (displayGroups.length === 0) return
    if (allGroupsCollapsed) {
      setCollapsed({})
      return
    }
    setCollapsed(Object.fromEntries(displayGroups.map(([workspacePath]) => [workspacePath, true])))
  }

  const handleDeleteThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    const confirmMessage = t('sidebarThreadDeleteConfirm', { title: thread.title })
    if (!(await confirmDialog(confirmMessage))) return
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
    if (!(await confirmDialog(confirmMessage))) return
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
    if (!(await confirmDialog(confirmMessage))) return
    await onRemoveWorkspace(workspacePath)
  }

  const handleDeleteRequirementDraft = async (draft: SddDraftHistoryItem): Promise<void> => {
    const draftId = draft.id.trim()
    if (!draftId || deletingDraftIds[draftId]) return
    const workspaceKey = draft.workspaceRoot
    const confirmMessage = t('sddDraftHistoryDeleteConfirm', { title: draft.title })
    if (!(await confirmDialog(confirmMessage))) return

    setDeletingDraftIds((prev) => ({ ...prev, [draftId]: true }))
    setDraftHistoryErrors((prev) => {
      const next = { ...prev }
      delete next[workspaceKey]
      return next
    })
    try {
      const result = await deleteSddDraft(draft)
      if (!result.ok) {
        setDraftHistoryErrors((prev) => ({
          ...prev,
          [workspaceKey]: t('sddDraftHistoryDeleteFailed', { message: result.message })
        }))
        return
      }
      setDraftHistoryByWorkspace((current) => {
        const next = Object.fromEntries(
          Object.entries(current)
            .map(([workspacePath, items]) => [
              workspacePath,
              items.filter((item) => item.id !== draftId)
            ] as const)
            .filter(([, items]) => items.length > 0)
        )
        return next
      })
      setDraftHistoryRefreshVersion((version) => version + 1)
    } finally {
      setDeletingDraftIds((prev) => {
        const next = { ...prev }
        delete next[draftId]
        return next
      })
    }
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
        {displayGroups.length === 0 ? (
          <SidebarEmpty
            runtimeReady={runtimeReady}
            hasWorkspace={!!workspaceRoot}
            onPickWorkspace={onPickWorkspace}
            t={t}
          />
        ) : null}

        {displayGroups.map(([workspacePath, list]) => {
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
          const draftHistory = sddDraftHistoryForWorkspace(filteredDraftHistoryByWorkspace, workspacePath)
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
                  <SddDraftHistoryRows
                    items={draftHistory}
                    activeDraftId={activeSddDraftId}
                    deletingDraftIds={deletingDraftIds}
                    error={draftHistoryErrors[workspacePath] ?? ''}
                    onOpen={onOpenRequirementDraft}
                    onDelete={(draft) => void handleDeleteRequirementDraft(draft)}
                    t={t}
                  />
                  {sortedThreads.length === 0 && draftHistory.length === 0 ? (
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

export function SddDraftHistoryRows({
  items,
  activeDraftId,
  onOpen,
  onDelete,
  deletingDraftIds = {},
  error = '',
  t
}: {
  items: SddDraftHistoryItem[]
  activeDraftId: string
  onOpen: (draft: SddDraft) => void
  onDelete?: (draft: SddDraftHistoryItem) => void
  deletingDraftIds?: Record<string, boolean>
  error?: string
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement | null {
  const itemKey = items.map((item) => item.id).join('\n')
  const [collapsed, setCollapsed] = useState(true)
  const [visibleCount, setVisibleCount] = useState(SDD_DRAFT_HISTORY_PAGE_SIZE)

  useEffect(() => {
    setCollapsed(true)
    setVisibleCount(SDD_DRAFT_HISTORY_PAGE_SIZE)
  }, [itemKey])

  if (items.length === 0) return null

  const visibleItems = items.slice(0, visibleCount)
  const remainingCount = Math.max(0, items.length - visibleItems.length)
  const nextCount = Math.min(SDD_DRAFT_HISTORY_PAGE_SIZE, remainingCount)

  return (
    <div className="mb-1.5 rounded-lg border border-transparent bg-[var(--ds-sidebar-row-hover)]/35 px-1 py-1">
      <SidebarTreeRow
        title={t('sddDraftHistoryTitle')}
        ariaLabel={collapsed ? t('sddDraftHistoryExpand') : t('sddDraftHistoryCollapse')}
        onClick={() => setCollapsed((current) => !current)}
        className="min-h-[28px]"
        buttonClassName="items-center gap-1.5 px-2 py-1.5"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ds-faint">
          {t('sddDraftHistoryTitle')}
        </span>
        <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint tabular-nums">
          {items.length}
        </span>
      </SidebarTreeRow>
      {error ? (
        <div className="px-2 py-1 text-[11.5px] leading-4 text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {!collapsed ? (
        <div className="space-y-[2px] pt-1">
          {visibleItems.map((item) => (
            <SidebarTreeRow
              key={item.id}
              active={activeDraftId === item.id}
              activeVariant="outline"
              actionsVisibility={deletingDraftIds[item.id] ? 'visible' : 'hidden'}
              actionsLayout="overlay"
              actions={
                onDelete ? (
                  <SidebarIconButton
                    onClick={() => onDelete(item)}
                    disabled={deletingDraftIds[item.id] === true}
                    tone="danger"
                    title={t('sddDraftHistoryDelete')}
                    ariaLabel={t('sddDraftHistoryDelete')}
                    stopPropagation
                  >
                    {deletingDraftIds[item.id] ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    ) : (
                      <Trash2 className="h-3 w-3" strokeWidth={1.9} />
                    )}
                  </SidebarIconButton>
                ) : null
              }
              className="min-h-[32px]"
              buttonClassName="items-center gap-2 px-2 py-1.5"
              title={item.relativePath}
              ariaLabel={t('sddDraftHistoryOpen', { title: item.title })}
              onClick={() => onOpen(item)}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition ${
                  activeDraftId === item.id
                    ? 'border-accent/25 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]'
                    : 'border-ds-border-muted bg-ds-card/70 text-ds-faint group-hover:border-accent/20 group-hover:bg-accent/10 group-hover:text-accent'
                }`}
                aria-hidden="true"
              >
                <ClipboardList className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4 text-ds-ink">{item.title}</span>
                <span className="block truncate text-[11.5px] leading-4 text-ds-faint">{item.relativePath}</span>
              </span>
              <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                {item.source === 'remembered' ? t('sddDraftHistoryRemembered') : t('sddDraftHistoryDisk')}
              </span>
            </SidebarTreeRow>
          ))}
        </div>
      ) : null}
      {!collapsed && remainingCount > 0 ? (
        <button
          type="button"
          onClick={() =>
            setVisibleCount((count) => Math.min(items.length, count + SDD_DRAFT_HISTORY_PAGE_SIZE))
          }
          className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
        >
          {t('sddDraftHistoryShowMore', { count: nextCount })}
        </button>
      ) : null}
    </div>
  )
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
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
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
      className="ds-thread-context-menu ds-no-drag fixed z-50 min-w-[168px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_16px_42px_rgba(20,47,95,0.16)] backdrop-blur-xl dark:bg-ds-card"
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
