import type { ReactElement, RefObject } from 'react'
import { ChevronDown, Copy, Download, FileCode2, FilePenLine, FolderOpen, Loader2, Save, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteExportFormat } from '@shared/write-export'
import type { WritePreviewMode, WriteSaveStatus } from '../../write/write-workspace-store'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import {
  WRITE_EXPORT_FORMATS,
  exportFormatLabel,
  modeButtonClass,
  toolbarIconButtonClass,
  toolbarMenuButtonClass,
  type WriteModeMenuItem
} from './write-workspace-view-utils'

type Props = {
  activeFileIsImage: boolean
  activeFileIsText: boolean
  activeFileLabel: string
  activeFileName: string
  activeFilePath: string
  assistantOpen: boolean
  exportInFlight: boolean
  exportMenuOpen: boolean
  exportMenuRef: RefObject<HTMLDivElement | null>
  leftSidebarCollapsed: boolean
  liveModeActive: boolean
  modeMenuItems: WriteModeMenuItem[]
  modeMenuOpen: boolean
  modeMenuRef: RefObject<HTMLDivElement | null>
  onCopyRichText: () => void
  onExportFile: (format: WriteExportFormat) => void
  onPickWorkspace: () => void
  onSave: () => void
  onToggleLeftSidebar: () => void
  previewMode: WritePreviewMode
  readOnly: boolean
  saveLabel: string
  saveStatus: WriteSaveStatus
  setAssistantOpen: (open: boolean) => void
  setExportMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void
  setModeMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void
  setPreviewMode: (mode: WritePreviewMode) => void
}

export function WriteWorkspaceToolbar({
  activeFileIsImage,
  activeFileIsText,
  activeFileLabel,
  activeFileName,
  activeFilePath,
  assistantOpen,
  exportInFlight,
  exportMenuOpen,
  exportMenuRef,
  leftSidebarCollapsed,
  liveModeActive,
  modeMenuItems,
  modeMenuOpen,
  modeMenuRef,
  onCopyRichText,
  onExportFile,
  onPickWorkspace,
  onSave,
  onToggleLeftSidebar,
  previewMode,
  readOnly,
  saveLabel,
  saveStatus,
  setAssistantOpen,
  setExportMenuOpen,
  setModeMenuOpen,
  setPreviewMode
}: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="ds-stage-inset -mx-3 shrink-0 sm:-mx-4 md:-mx-6 lg:-mx-8">
      <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[56px] w-full items-stretch overflow-visible rounded-[18px]">
        <div className="write-workspace-toolbar-grid grid w-full min-w-0 items-center gap-2 px-3 py-2 sm:px-4 md:pl-5 md:pr-2 lg:gap-4">
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <FilePenLine className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1 leading-none">
              <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ds-ink">
                {activeFileName}
              </div>
              <div className="mt-1.5 truncate text-[12px] text-ds-faint">
                {activeFileLabel}
              </div>
            </div>
          </div>

          <div
            ref={modeMenuRef}
            className="write-workspace-toolbar-modes relative flex min-w-0 items-center justify-start gap-1 rounded-xl border border-ds-border-muted bg-white/68 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:bg-white/[0.06] dark:shadow-none"
          >
            <button
              type="button"
              onClick={() => setPreviewMode('live')}
              disabled={!activeFileIsText}
              className={`${modeButtonClass(liveModeActive)} gap-1.5 ${!activeFileIsText ? 'cursor-not-allowed opacity-45' : ''}`}
              title={t('writeModeLive')}
              aria-label={t('writeModeLive')}
            >
              <FileCode2 className="h-4 w-4" strokeWidth={1.85} />
              <span className="hidden text-[12.5px] font-semibold sm:inline">{t('writeModeLiveShort')}</span>
            </button>
            <button
              type="button"
              onClick={() => setModeMenuOpen((open) => !open)}
              disabled={!activeFileIsText}
              className={`${modeButtonClass(modeMenuOpen || !liveModeActive)} px-2 ${!activeFileIsText ? 'cursor-not-allowed opacity-45' : ''}`}
              title={t('writeModePreview')}
              aria-label={t('writeModePreview')}
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
            >
              <ChevronDown
                className={`h-4 w-4 transition ${modeMenuOpen ? 'rotate-180' : ''}`}
                strokeWidth={1.9}
              />
            </button>
            {modeMenuOpen ? (
              <div
                role="menu"
                className="absolute left-0 top-full z-30 mt-2 min-w-[188px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-[#131722]"
              >
                {modeMenuItems.map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    role="menuitem"
                    disabled={!activeFileIsText}
                    onClick={() => {
                      setPreviewMode(item.mode)
                      setModeMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] transition ${
                      item.active
                        ? 'bg-accent/12 text-accent'
                        : 'text-ds-ink hover:bg-slate-100'
                    } ${!activeFileIsText ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      {item.icon}
                      <span>{item.shortLabel}</span>
                    </span>
                    {item.active ? (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">
                        ON
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="write-workspace-toolbar-actions flex min-w-0 items-center justify-start gap-1.5">
            <button
              type="button"
              onClick={onPickWorkspace}
              className={toolbarIconButtonClass()}
              title={t('changeWorkspace')}
            >
              <FolderOpen className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <button
              type="button"
              onClick={() => setAssistantOpen(!assistantOpen)}
              className={toolbarIconButtonClass(assistantOpen)}
              title={t('writeToggleAssistant')}
              aria-label={t('writeToggleAssistant')}
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <div ref={exportMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen((open) => !open)}
                disabled={!activeFilePath || !activeFileIsText || exportInFlight}
                className={`${toolbarMenuButtonClass(exportMenuOpen)} disabled:cursor-not-allowed disabled:opacity-40`}
                title={exportInFlight ? t('writeExporting') : t('writeExport')}
                aria-label={exportInFlight ? t('writeExporting') : t('writeExport')}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
              >
                {exportInFlight ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.85} />
                ) : (
                  <Download className="h-4 w-4" strokeWidth={1.85} />
                )}
                <span className="hidden lg:inline">{t('writeExport')}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-70" strokeWidth={1.9} />
              </button>
              {exportMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-2xl border border-ds-border bg-ds-card/95 p-1.5 shadow-[0_22px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onCopyRichText}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                  >
                    <span>{t('writeCopyRichText')}</span>
                    <Copy className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                  </button>
                  <div className="my-1 h-px bg-ds-border-muted" />
                  {WRITE_EXPORT_FORMATS.map((format) => (
                    <button
                      key={format}
                      type="button"
                      role="menuitem"
                      onClick={() => onExportFile(format)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                    >
                      <span>{exportFormatLabel(format, t)}</span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ds-faint">
                        {format}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={!activeFilePath || !activeFileIsText || readOnly}
              className={`${toolbarIconButtonClass()} disabled:cursor-not-allowed disabled:opacity-40`}
              title={activeFileIsImage ? t('writeImageSaveDisabled') : readOnly ? t('writeReadOnlySaveDisabled') : t('writeSaveFile')}
              aria-label={activeFileIsImage ? t('writeImageSaveDisabled') : readOnly ? t('writeReadOnlySaveDisabled') : t('writeSaveFile')}
            >
              <Save className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <span className={`ml-1 inline-flex min-w-[64px] justify-center rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${
              readOnly
                ? 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
                : saveStatus === 'error'
                ? 'bg-red-500/12 text-red-600 dark:text-red-300'
                : saveStatus === 'dirty'
                  ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                  : saveStatus === 'saving'
                    ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                    : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
            }`}>
              {saveLabel}
            </span>
          </div>
        </div>
      </header>
    </div>
  )
}
