import type { FormEvent, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  RefreshCw,
  Settings,
  Smartphone,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeDirnameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { WriteFileTree } from './WriteFileTree'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule'
  connectPhoneSidebarOpen: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
  onToggleSidebar: () => void
}

type EntryDialog =
  | { kind: 'create-file'; parentDirectory?: string; value: string }
  | { kind: 'create-folder'; parentDirectory?: string; value: string }
  | { kind: 'rename'; entry: WorkspaceEntry; value: string }
  | { kind: 'delete'; entry: WorkspaceEntry }

type Translate = (key: string, opts?: Record<string, unknown>) => string

export function WriteSidebar({
  activeView,
  connectPhoneSidebarOpen,
  onCodeOpen,
  onWriteOpen,
  onOpenSettings,
  onToggleConnectPhone,
  onToggleSidebar
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const [entryDialog, setEntryDialog] = useState<EntryDialog | null>(null)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({})
  const {
    defaultWorkspaceRoot,
    workspaceRoots,
    settingsError,
    workspaceRoot,
    rootDirectory,
    entriesByDir,
    expandedDirs,
    loadingDirs,
    treeError,
    activeFilePath,
    loadWriteSettings,
    selectWriteWorkspace,
    addWriteWorkspace,
    removeWriteWorkspace,
    toggleDirectory,
    openFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    refreshWorkspace,
    setFileError
  } = useWriteWorkspaceStore()

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  const root = rootDirectory || workspaceRoot
  const rootLoading = Boolean(
    loadingDirs.__root__
    || loadingDirs[root]
    || (workspaceRoot.trim() && !entriesByDir[root])
  )

  const defaultParentDirectory = (): string => {
    if (!root) return workspaceRoot
    if (activeFilePath && activeFilePath.startsWith(root)) return writeDirnameFromPath(activeFilePath)
    return root
  }

  const suggestedCreatePath = (
    kind: 'file' | 'folder',
    parentDirectory?: string
  ): { parent: string; suggested: string } => {
    const explicitParent = parentDirectory?.trim()
    const parent = explicitParent || defaultParentDirectory()
    const relativeParent = writeRelativeToWorkspace(root, parent)
    const baseName = kind === 'file' ? 'untitled.md' : 'new-folder'
    const suggested = explicitParent
      ? baseName
      : relativeParent === writeBasenameFromPath(root)
        ? baseName
        : `${relativeParent}/${baseName}`
    return { parent: explicitParent || root, suggested }
  }

  const openCreateFileDialog = async (parentDirectory?: string): Promise<void> => {
    if (!workspaceRoot.trim() || !root) {
      await pickWriteWorkspace()
      return
    }
    const { suggested } = suggestedCreatePath('file', parentDirectory)
    setEntryDialog({ kind: 'create-file', parentDirectory, value: suggested })
  }

  const openCreateDirectoryDialog = async (parentDirectory?: string): Promise<void> => {
    if (!workspaceRoot.trim() || !root) {
      await pickWriteWorkspace()
      return
    }
    const { suggested } = suggestedCreatePath('folder', parentDirectory)
    setEntryDialog({ kind: 'create-folder', parentDirectory, value: suggested })
  }

  const openRenameEntryDialog = (entry: WorkspaceEntry): void => {
    setEntryDialog({ kind: 'rename', entry, value: entry.name })
  }

  const openDeleteEntryDialog = (entry: WorkspaceEntry): void => {
    setEntryDialog({ kind: 'delete', entry })
  }

  const submitEntryDialog = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!entryDialog) return

    if (entryDialog.kind === 'delete') {
      const ok = await deleteEntry(workspaceRoot, entryDialog.entry.path)
      if (ok) setEntryDialog(null)
      return
    }

    const value = entryDialog.value.trim()
    if (!value) return

    if (entryDialog.kind === 'rename') {
      if (value === entryDialog.entry.name) {
        setEntryDialog(null)
        return
      }
      const renamed = await renameEntry(workspaceRoot, entryDialog.entry.path, value)
      if (renamed) setEntryDialog(null)
      return
    }

    const { parent } = suggestedCreatePath(
      entryDialog.kind === 'create-file' ? 'file' : 'folder',
      entryDialog.parentDirectory
    )
    const created = entryDialog.kind === 'create-file'
      ? await createFile(workspaceRoot, writeJoinPath(parent, value))
      : await createDirectory(workspaceRoot, writeJoinPath(parent, value))
    if (created) setEntryDialog(null)
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(workspaceRoot || defaultWorkspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        await addWriteWorkspace(picked.path)
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const selectWorkspaceAndThread = async (workspacePath: string): Promise<void> => {
    await selectWriteWorkspace(workspacePath)
    if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(workspacePath)
  }

  const toggleWorkspaceGroup = async (workspacePath: string): Promise<void> => {
    if (workspacePath !== workspaceRoot) {
      await selectWorkspaceAndThread(workspacePath)
      setCollapsedWorkspaces((current) => ({ ...current, [workspacePath]: false }))
      return
    }
    setCollapsedWorkspaces((current) => ({
      ...current,
      [workspacePath]: current[workspacePath] !== true
    }))
  }

  const removeWorkspaceFromList = async (workspacePath: string): Promise<void> => {
    if (workspaceRoots.length <= 1) return
    if (!window.confirm(t('writeRemoveWorkspaceConfirm', { name: writeBasenameFromPath(workspacePath) }))) return
    await removeWriteWorkspace(workspacePath)
  }

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      onCollapse={onToggleSidebar}
      footer={
        <div className="space-y-1">
          <SidebarCommandRow
            icon={<Smartphone className="h-4 w-4" strokeWidth={1.75} />}
            label={t('claw')}
            onClick={onToggleConnectPhone}
            active={connectPhoneSidebarOpen}
            variant="footer"
          />
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={() => onOpenSettings('write')}
            variant="footer"
          />
        </div>
      }
    >
      <div className="ds-no-drag flex flex-col px-0.5">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />
        <SidebarCommandRow
          icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.9} />}
          label={t('writeCreateFile')}
          onClick={() => void openCreateFileDialog()}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<FolderOpen className="h-4 w-4" strokeWidth={1.75} />}
          label={t('writeAddWorkspace')}
          onClick={() => void pickWriteWorkspace()}
        />
      </div>

      <div className="ds-no-drag mx-1.5 my-3" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : (
      <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
        <SidebarSectionHeader
          label={t('writeSpaces')}
          actions={
            <SidebarIconButton
              onClick={() => void pickWriteWorkspace()}
              title={t('writeAddWorkspace')}
              ariaLabel={t('writeAddWorkspace')}
              stopPropagation
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </SidebarIconButton>
          }
        />

        {settingsError ? (
          <div className="mx-2 mt-1 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {settingsError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {workspaceRoots.length === 0 ? (
            <button
              type="button"
              onClick={() => void pickWriteWorkspace()}
              className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                {t('writeAddWorkspace')}
              </span>
            </button>
          ) : null}

          {workspaceRoots.map((workspacePath) => {
            const active = workspacePath === workspaceRoot
            const collapsed = active ? collapsedWorkspaces[workspacePath] === true : true
            const removable = workspaceRoots.length > 1 && workspacePath !== defaultWorkspaceRoot
            return (
              <div key={workspacePath} className="mb-1">
                <SidebarTreeRow
                  active={active}
                  title={workspacePath}
                  onClick={() => void toggleWorkspaceGroup(workspacePath)}
                  className="min-h-[36px]"
                  buttonClassName="items-center gap-2 px-2.5 py-2"
                  actions={
                    active || removable ? (
                      <>
                        {active ? (
                          <>
                            <SidebarIconButton
                              onClick={() => void openCreateFileDialog(root)}
                              title={t('writeCreateFile')}
                              ariaLabel={t('writeCreateFile')}
                              tone="accent"
                              stopPropagation
                            >
                              <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </SidebarIconButton>
                            <SidebarIconButton
                              onClick={() => void openCreateDirectoryDialog(root)}
                              title={t('writeCreateFolder')}
                              ariaLabel={t('writeCreateFolder')}
                              stopPropagation
                            >
                              <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </SidebarIconButton>
                            <SidebarIconButton
                              onClick={() => void refreshWorkspace(workspaceRoot)}
                              title={t('writeRefreshWorkspace')}
                              ariaLabel={t('writeRefreshWorkspace')}
                              stopPropagation
                            >
                              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </SidebarIconButton>
                          </>
                        ) : null}

                        {removable ? (
                          <SidebarIconButton
                            onClick={() => void removeWorkspaceFromList(workspacePath)}
                            title={t('writeRemoveWorkspace')}
                            ariaLabel={t('writeRemoveWorkspace')}
                            tone="danger"
                            stopPropagation
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                          </SidebarIconButton>
                        ) : null}
                      </>
                    ) : undefined
                  }
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                  )}
                  {collapsed ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{writeBasenameFromPath(workspacePath)}</span>
                </SidebarTreeRow>

                {active && !collapsed ? (
                  <div className="mt-1 pl-3">
                    <div className="px-2.5 pb-1 text-[11.5px] text-ds-faint">
                      <span className="block truncate" title={workspacePath}>
                        {workspacePath === defaultWorkspaceRoot ? t('writeDefaultSpace') : workspacePath}
                      </span>
                    </div>
                    <WriteFileTree
                      rootDirectory={root}
                      entriesByDir={entriesByDir}
                      expandedDirs={expandedDirs}
                      loadingDirs={loadingDirs}
                      selectedFilePath={activeFilePath}
                      error={treeError}
                      rootLoading={rootLoading}
                      onToggleDir={(path) => void toggleDirectory(workspaceRoot, path)}
                      onSelectFile={(path) => void openFile(workspaceRoot, path)}
                      onCreateFile={(directoryPath) => void openCreateFileDialog(directoryPath)}
                      onCreateDirectory={(directoryPath) => void openCreateDirectoryDialog(directoryPath)}
                      onRenameEntry={openRenameEntryDialog}
                      onDeleteEntry={openDeleteEntryDialog}
                      onRefresh={() => void refreshWorkspace(workspaceRoot)}
                      showHeader={false}
                      showRootLabel={false}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      )}
    </SidebarFrame>
    {entryDialog ? (
      <WriteEntryDialog
        dialog={entryDialog}
        onClose={() => setEntryDialog(null)}
        onValueChange={(value) =>
          setEntryDialog((current) => {
            if (!current || current.kind === 'delete') return current
            return { ...current, value }
          })
        }
        onSubmit={(event) => void submitEntryDialog(event)}
        t={t}
      />
    ) : null}
    </>
  )
}

function entryDialogTitle(dialog: EntryDialog, t: Translate): string {
  if (dialog.kind === 'create-file') return t('writeCreateFile')
  if (dialog.kind === 'create-folder') return t('writeCreateFolder')
  if (dialog.kind === 'rename') return t('writeRenameEntry')
  return dialog.entry.type === 'directory' ? t('writeDeleteFolder') : t('writeDeleteFile')
}

function entryDialogSubmitLabel(dialog: EntryDialog, t: Translate): string {
  if (dialog.kind === 'rename') return t('writeEntryDialogRename')
  if (dialog.kind === 'delete') return t('writeEntryDialogDelete')
  return t('writeEntryDialogCreate')
}

function entryDialogDescription(dialog: EntryDialog, t: Translate): string {
  if (dialog.kind === 'delete') {
    return dialog.entry.type === 'directory'
      ? t('writeDeleteFolderConfirm', { name: dialog.entry.name })
      : t('writeDeleteFileConfirm', { name: dialog.entry.name })
  }
  if (dialog.kind === 'rename') return t('writeRenameEntryPrompt')
  if (dialog.kind === 'create-file') return t('writeCreateFilePrompt')
  return t('writeCreateFolderPrompt')
}

function WriteEntryDialog({
  dialog,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  dialog: EntryDialog
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: Translate
}): ReactElement {
  const deleting = dialog.kind === 'delete'
  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
          {entryDialogTitle(dialog, t)}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {entryDialogDescription(dialog, t)}
        </p>
        {!deleting ? (
          <input
            autoFocus
            value={dialog.value}
            onChange={(event) => onValueChange(event.target.value)}
            className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          />
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('writeEntryDialogCancel')}
          </button>
          <button
            type="submit"
            className={`rounded-xl px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 ${
              deleting ? 'bg-red-500' : 'bg-accent'
            }`}
          >
            {entryDialogSubmitLabel(dialog, t)}
          </button>
        </div>
      </form>
    </div>
  )
}
