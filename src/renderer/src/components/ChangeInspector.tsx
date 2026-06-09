import type { ReactElement } from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileEdit, PanelRightClose } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../agent/types'
import {
  countDiffStats,
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay,
} from '../lib/diff-stats'
import { useChatStore } from '../store/chat-store'
import { DiffView } from './DiffView'

/**
 * Right-side change inspector — file_change items only.
 * Selecting a row reveals the unified patch in the bottom panel.
 */
export function ChangeInspector({
  blocks,
  className,
  onCollapse
}: {
  blocks: ChatBlock[]
  className?: string
  onCollapse: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const selectedId = useChatStore((s) => s.inspectorSelectedId)
  const selectInspectorItem = useChatStore((s) => s.selectInspectorItem)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)

  const fileChanges = useMemo<ToolBlock[]>(() => {
    return blocks.flatMap((block): ToolBlock[] => {
      if (!(block.kind === 'tool' && block.toolKind === 'file_change')) {
        return []
      }

      const detailText = extractUnifiedDiffText(block.detail)
      if (!detailText) return []

      return [
        {
          ...block,
          detail: detailText,
          filePath: extractDiffFilePath(detailText, block.filePath)
        }
      ]
    })
  }, [blocks])

  useEffect(() => {
    if (fileChanges.length === 0 && selectedId !== null) {
      selectInspectorItem(null)
      return
    }
    if (selectedId && !fileChanges.some((b) => b.id === selectedId)) {
      selectInspectorItem(fileChanges[fileChanges.length - 1]?.id ?? null)
    }
  }, [fileChanges, selectedId, selectInspectorItem])

  const active = fileChanges.find((b) => b.id === selectedId) ?? fileChanges[fileChanges.length - 1]

  return (
    <aside
      className={`ds-no-drag ds-panel-ghost flex flex-col border-l border-ds-border-muted backdrop-blur-xl ${className ?? ''}`}
    >
      <div className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-ds-border-muted px-3 py-3">
        <button
          type="button"
          onClick={onCollapse}
          className="ds-sidebar-toggle-button shrink-0"
          aria-label={t('rightPanelCollapse')}
          title={t('rightPanelCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-ds-muted">
            {t('inspectorTitle')}
          </div>
          <div className="mt-1 truncate text-[11px] text-ds-faint">
            {fileChanges.length > 0
              ? t('inspectorSummaryFiles', { count: fileChanges.length })
              : t('inspectorEmpty')}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {fileChanges.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
            <div>
              <FileEdit className="mx-auto h-7 w-7 text-ds-faint" strokeWidth={1.25} />
              <div className="mt-3 text-[12px] font-medium text-ds-muted">
                {t('inspectorEmptyTitle')}
              </div>
              <div className="mt-1 text-[11px] leading-6 text-ds-faint">{t('inspectorEmpty')}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="max-h-[42%] min-h-0 overflow-y-auto py-2">
              <ul className="divide-y divide-ds-border-muted/60">
                {fileChanges.map((b) => {
                  const stats = countDiffStats(b.detail)
                  const displayPath = formatFilePathForDisplay(b.filePath, workspaceRoot)
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => selectInspectorItem(b.id)}
                        className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition ${
                          active?.id === b.id
                            ? 'bg-ds-hover text-ds-ink'
                            : 'text-ds-ink hover:bg-ds-hover/70'
                        }`}
                      >
                        <FileEdit
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                            b.status === 'error' ? 'text-red-700' : 'text-ds-muted'
                          }`}
                          strokeWidth={1.75}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-ds-ink">
                            {displayPath ?? t('toolActionFile')}
                          </div>
                          {stats ? (
                            <div className="mt-0.5 flex gap-2 text-[10px] font-mono">
                              <span className="text-ds-diff-added">
                                +{stats.added}
                              </span>
                              <span className="text-ds-diff-removed">
                                -{stats.removed}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        {b.status === 'running' ? (
                          <span className="rounded-full bg-amber-200/40 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-700/30 dark:text-amber-100">
                            {t('inspectorStatusRunning')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="ds-panel-strip flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-ds-border-muted">
              {active?.detail ? (
                <DiffView patch={active.detail} maxHeight={9999} className="h-full min-w-0 rounded-none border-0" />
              ) : (
                <div className="ds-surface-soft flex h-full items-center justify-center border border-dashed border-ds-border-muted px-4 py-6 text-center text-[11px] leading-6 text-ds-muted">
                  {t('inspectorSelectHint')}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
