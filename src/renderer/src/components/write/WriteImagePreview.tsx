import { useEffect, useState, type ReactElement } from 'react'
import { ExternalLink, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  writeBasenameFromPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import {
  clamp,
  toolbarIconButtonClass,
  toolbarMenuButtonClass
} from './write-workspace-view-utils'

const IMAGE_MIN_ZOOM = 25
const IMAGE_MAX_ZOOM = 300
const IMAGE_ZOOM_STEP = 25

type WriteImagePreviewProps = {
  src: string
  filePath: string
  mimeType: string
  size: number
  workspaceRoot: string
}

type WriteImageFitMode = 'fit' | 'actual'

function clampImageZoom(value: number): number {
  return clamp(Math.round(value), IMAGE_MIN_ZOOM, IMAGE_MAX_ZOOM)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WriteImagePreview({
  src,
  filePath,
  mimeType,
  size,
  workspaceRoot
}: WriteImagePreviewProps): ReactElement {
  const { t } = useTranslation('common')
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [fitMode, setFitMode] = useState<WriteImageFitMode>('fit')
  const [zoom, setZoom] = useState(100)
  const fileName = writeBasenameFromPath(filePath)
  const relativePath = writeRelativeToWorkspace(workspaceRoot, filePath)
  const actualMode = fitMode === 'actual'
  useEffect(() => {
    setDimensions(null)
  }, [src, filePath])
  const openImage = (): void => {
    if (typeof window.dsGui?.openEditorPath !== 'function') return
    void window.dsGui.openEditorPath({ path: filePath, workspaceRoot, editorId: 'system' }).catch(() => undefined)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(0,136,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,250,255,0.68))] dark:bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.13),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))]">
      <div className="flex min-h-[54px] shrink-0 items-center justify-between gap-3 border-b border-ds-border-muted px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ds-ink">{fileName}</div>
            <div className="mt-1 truncate text-[12px] text-ds-faint" title={relativePath}>
              {relativePath}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-ds-border-muted bg-white/48 p-1 dark:bg-white/[0.035]">
          <button
            type="button"
            onClick={() => {
              setFitMode('actual')
              setZoom((value) => clampImageZoom(value - IMAGE_ZOOM_STEP))
            }}
            className={toolbarIconButtonClass()}
            title={t('writeImageZoomOut')}
            aria-label={t('writeImageZoomOut')}
          >
            <ZoomOut className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <input
            type="range"
            min={IMAGE_MIN_ZOOM}
            max={IMAGE_MAX_ZOOM}
            step={IMAGE_ZOOM_STEP}
            value={zoom}
            aria-label={t('writeImageZoom')}
            className="h-8 w-24 accent-[var(--ds-accent)]"
            onChange={(event) => {
              setFitMode('actual')
              setZoom(clampImageZoom(Number(event.target.value)))
            }}
          />
          <button
            type="button"
            onClick={() => {
              setFitMode('actual')
              setZoom((value) => clampImageZoom(value + IMAGE_ZOOM_STEP))
            }}
            className={toolbarIconButtonClass()}
            title={t('writeImageZoomIn')}
            aria-label={t('writeImageZoomIn')}
          >
            <ZoomIn className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <button
            type="button"
            onClick={() => setFitMode((mode) => mode === 'fit' ? 'actual' : 'fit')}
            className={`${toolbarMenuButtonClass(fitMode === 'fit')} min-w-[52px] justify-center`}
            title={fitMode === 'fit' ? t('writeImageActualSize') : t('writeImageFit')}
            aria-label={fitMode === 'fit' ? t('writeImageActualSize') : t('writeImageFit')}
          >
            {fitMode === 'fit' ? t('writeImageFitShort') : `${zoom}%`}
          </button>
        </div>
        <button
          type="button"
          onClick={openImage}
          className={toolbarIconButtonClass()}
          title={t('writeImageOpenExternal')}
          aria-label={t('writeImageOpenExternal')}
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.85} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <img
            src={src}
            alt={fileName}
            className={`${actualMode ? 'max-w-none' : 'max-h-full max-w-full'} select-none rounded-lg object-contain shadow-[0_18px_50px_rgba(15,23,42,0.16)]`}
            style={actualMode && dimensions ? {
              width: `${Math.round(dimensions.width * zoom / 100)}px`,
              height: 'auto'
            } : undefined}
            onLoad={(event) => {
              const image = event.currentTarget
              setDimensions({ width: image.naturalWidth, height: image.naturalHeight })
            }}
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-ds-border-muted bg-white/44 px-4 py-2 text-[11.5px] text-ds-faint dark:bg-white/[0.035] sm:px-5">
        <span className="rounded-lg bg-ds-hover/70 px-2 py-1 font-mono">{mimeType}</span>
        <span className="rounded-lg bg-ds-hover/70 px-2 py-1 font-mono">{formatBytes(size)}</span>
        {dimensions ? (
          <span className="rounded-lg bg-ds-hover/70 px-2 py-1 font-mono">
            {dimensions.width} x {dimensions.height}
          </span>
        ) : null}
      </div>
    </div>
  )
}
