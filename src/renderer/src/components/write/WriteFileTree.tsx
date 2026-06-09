import type { ReactElement, ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileText, FilePlus2, Folder, FolderPlus, Image, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { isWriteImageFileExtension, isWriteWorkspaceEntry } from '@shared/write-text-file'
import {
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'

type Props = {
  rootDirectory: string
  entriesByDir: Record<string, WorkspaceEntry[]>
  expandedDirs: Set<string>
  loadingDirs: Record<string, boolean>
  selectedFilePath: string | null
  error: string | null
  rootLoading?: boolean
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
  onCreateFile: (directoryPath?: string) => void
  onCreateDirectory: (directoryPath?: string) => void
  onRenameEntry: (entry: WorkspaceEntry) => void
  onDeleteEntry: (entry: WorkspaceEntry) => void
  onRefresh: () => void
  showHeader?: boolean
  showRootLabel?: boolean
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function basenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || normalized
}

function relativeDisplayPath(root: string, target: string): string {
  const normalizedRoot = normalizePath(root)
  const normalizedTarget = normalizePath(target)
  if (normalizedTarget === normalizedRoot) return basenameFromPath(normalizedTarget)
  const prefix = `${normalizedRoot}/`
  if (normalizedTarget.startsWith(prefix)) {
    return normalizedTarget.slice(prefix.length)
  }
  return basenameFromPath(normalizedTarget)
}

function isAssistantInternalDirectory(entry: WorkspaceEntry): boolean {
  return entry.type === 'directory' && entry.name === '.deepseek'
}

function isWriteDocument(entry: WorkspaceEntry): boolean {
  return !isAssistantInternalDirectory(entry) && isWriteWorkspaceEntry(entry)
}

function isImageEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'file' && isWriteImageFileExtension(entry.ext)
}

type TreeActionButtonProps = {
  title: string
  children: ReactNode
  onClick: () => void
  tone?: 'default' | 'accent' | 'danger'
}

function TreeActionButton({
  title,
  children,
  onClick,
  tone = 'default'
}: TreeActionButtonProps): ReactElement {
  return (
    <SidebarIconButton
      onClick={onClick}
      title={title}
      tone={tone}
      stopPropagation
    >
      {children}
    </SidebarIconButton>
  )
}

export function WriteFileTree({
  rootDirectory,
  entriesByDir,
  expandedDirs,
  loadingDirs,
  selectedFilePath,
  error,
  rootLoading = false,
  onToggleDir,
  onSelectFile,
  onCreateFile,
  onCreateDirectory,
  onRenameEntry,
  onDeleteEntry,
  onRefresh,
  showHeader = true,
  showRootLabel = true
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hasRootSnapshot = Object.prototype.hasOwnProperty.call(entriesByDir, rootDirectory)
  const rootEntries = (entriesByDir[rootDirectory] ?? []).filter(isWriteDocument)

  const renderEntries = (dirPath: string, depth: number): ReactElement[] => {
    const entries = (entriesByDir[dirPath] ?? []).filter(isWriteDocument)
    return entries.flatMap((entry) => {
      const isDirectory = entry.type === 'directory'
      const expanded = isDirectory && expandedDirs.has(entry.path)
      const loading = isDirectory && loadingDirs[entry.path]
      const selected = !isDirectory && selectedFilePath === entry.path
      const imageEntry = isImageEntry(entry)
      const row = (
        <div key={entry.path}>
          <SidebarTreeRow
            active={selected}
            onClick={() => (isDirectory ? onToggleDir(entry.path) : onSelectFile(entry.path))}
            className="min-h-[34px]"
            buttonStyle={{ paddingLeft: 10 + depth * 14 }}
            title={relativeDisplayPath(rootDirectory, entry.path)}
            actions={
              <>
                {isDirectory ? (
                  <>
                    <TreeActionButton
                      title={t('writeCreateFileInFolder')}
                      onClick={() => onCreateFile(entry.path)}
                      tone="accent"
                    >
                      <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </TreeActionButton>
                    <TreeActionButton
                      title={t('writeCreateFolderInFolder')}
                      onClick={() => onCreateDirectory(entry.path)}
                    >
                      <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </TreeActionButton>
                  </>
                ) : null}
                <TreeActionButton
                  title={t('writeRenameEntry')}
                  onClick={() => onRenameEntry(entry)}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.85} />
                </TreeActionButton>
                <TreeActionButton
                  title={isDirectory ? t('writeDeleteFolder') : t('writeDeleteFile')}
                  onClick={() => onDeleteEntry(entry)}
                  tone="danger"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.85} />
                </TreeActionButton>
              </>
            }
          >
            {isDirectory ? (
              expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
              )
            ) : (
              <span className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {isDirectory ? (
              <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
            ) : imageEntry ? (
              <Image className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-accent' : 'text-emerald-600/75 dark:text-emerald-300/80'}`} strokeWidth={1.8} />
            ) : (
              <FileText className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-accent' : 'text-ds-faint/90'}`} strokeWidth={1.8} />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {loading ? (
              <span className="shrink-0 text-[11px] text-ds-faint">{t('writeLoadingShort')}</span>
            ) : null}
          </SidebarTreeRow>
          {isDirectory && expanded ? <div>{renderEntries(entry.path, depth + 1)}</div> : null}
        </div>
      )
      return row
    })
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {showHeader ? (
        <SidebarSectionHeader
          label={t('writeWorkspaceFiles')}
          actions={
            <>
              <TreeActionButton
                title={t('writeCreateFile')}
                onClick={() => onCreateFile()}
                tone="accent"
              >
                <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </TreeActionButton>
              <TreeActionButton
                title={t('writeCreateFolder')}
                onClick={() => onCreateDirectory()}
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </TreeActionButton>
              <TreeActionButton
                title={t('writeRefreshWorkspace')}
                onClick={onRefresh}
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              </TreeActionButton>
            </>
          }
        />
      ) : null}

      {showRootLabel ? (
        <div className="px-2 pb-1 text-[11.5px] text-ds-faint">
          <span className="block truncate" title={rootDirectory}>
            {basenameFromPath(rootDirectory)}
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {error ? (
          <div className="mx-2 mt-2 rounded-lg border border-red-200/70 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : rootLoading || !hasRootSnapshot ? (
          <div className="space-y-1.5 px-2 py-2" aria-label={t('writeLoadingWorkspace')}>
            {[0, 1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-8 animate-pulse rounded-lg bg-ds-hover/70"
                style={{ width: `${92 - item * 8}%` }}
              />
            ))}
          </div>
        ) : rootEntries.length === 0 ? (
          <div className="mx-2 mt-2 rounded-2xl border border-dashed border-ds-border-muted bg-ds-main/35 px-3 py-4">
            <p className="text-[14px] font-medium text-ds-muted">
              {t('writeWorkspaceEmpty')}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-ds-faint">
              {t('writeWorkspaceEmptySub')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onCreateFile()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
              >
                <FilePlus2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.9} />
                {t('writeCreateFirstFile')}
              </button>
              <button
                type="button"
                onClick={() => onCreateDirectory()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
              >
                <FolderPlus className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                {t('writeCreateFirstFolder')}
              </button>
            </div>
          </div>
        ) : (
          <div>{renderEntries(rootDirectory, 0)}</div>
        )}
      </div>
    </div>
  )
}
