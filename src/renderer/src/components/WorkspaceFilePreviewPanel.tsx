import type { WorkspaceFileReadResult, WorkspaceFileTarget } from '@shared/workspace-file'
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  Loader2,
  PanelRightClose
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { openWorkspacePathInEditor } from '../lib/open-workspace-path'
import {
  highlightCodeHtml,
  languageFromFilePath,
  renderFallbackCodeHtml
} from '../lib/code-highlighting'

type Props = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  className?: string
  onClose: () => void
}

const COPY_RESET_MS = 1400

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function splitPath(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean)
}

function relativePathSegments(path: string, workspaceRoot: string): string[] {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return splitPath(normalizedPath.slice(normalizedRoot.length + 1))
  }
  return splitPath(path)
}

function extensionBadge(path: string, language: string): string {
  const fileName = fileNameFromPath(path)
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const value = ext || language || 'txt'
  return value.slice(0, 3).toUpperCase()
}

export function WorkspaceFilePreviewPanel({
  target,
  workspaceRoot,
  className,
  onClose
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [result, setResult] = useState<WorkspaceFileReadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [highlightHtml, setHighlightHtml] = useState(() => renderFallbackCodeHtml(''))
  const scrollRef = useRef<HTMLDivElement>(null)
  const copyResetRef = useRef<number | null>(null)

  useEffect(() => {
    if (!target) {
      setResult(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setResult(null)

    void window.dsGui
      .readWorkspaceFile({
        ...target,
        workspaceRoot: target.workspaceRoot ?? workspaceRoot
      })
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((error) => {
        if (!cancelled) {
          setResult({
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [target, workspaceRoot])

  useEffect(() => {
    if (!result?.ok || !result.line) return
    const id = window.requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector(`[data-line="${result.line}"]`)
      row?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [result])

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    },
    []
  )

  const displayPath = useMemo(() => {
    if (result?.ok) return formatFilePathForDisplay(result.path, workspaceRoot) ?? result.path
    return target?.path ?? ''
  }, [result, target, workspaceRoot])
  const language = useMemo(() => {
    if (result?.ok) return languageFromFilePath(result.path)
    return target?.path ? languageFromFilePath(target.path) : ''
  }, [result, target])
  const lines = useMemo(() => (result?.ok ? result.content.split('\n') : []), [result])
  const breadcrumbSegments = useMemo(() => {
    const path = result?.ok ? result.path : target?.path ?? ''
    if (!path) return []
    const projectName = workspaceRoot ? fileNameFromPath(workspaceRoot) : 'Project'
    return ['Project', projectName, ...relativePathSegments(path, workspaceRoot)]
  }, [result, target, workspaceRoot])
  const currentFileName = displayPath ? fileNameFromPath(displayPath) : t('filePreviewTitle')
  const badge = extensionBadge(result?.ok ? result.path : target?.path ?? '', language)
  const activeLine = result?.ok && result.line && result.line >= 1 && result.line <= lines.length
    ? result.line
    : null
  const codeSurfaceStyle = activeLine
    ? ({
        '--ds-file-preview-active-line': activeLine - 1
      } as CSSProperties)
    : undefined

  useEffect(() => {
    if (!result?.ok) {
      setHighlightHtml(renderFallbackCodeHtml(''))
      return
    }

    let cancelled = false
    const fallback = renderFallbackCodeHtml(result.content)
    setHighlightHtml(fallback)

    void highlightCodeHtml(result.content, language).then((html) => {
      if (!cancelled) setHighlightHtml(html)
    })

    return () => {
      cancelled = true
    }
  }, [result, language])

  const openInEditor = (): void => {
    const path = result?.ok ? result.path : target?.path
    if (!path) return
    void openWorkspacePathInEditor(
      {
        path,
        line: result?.ok ? result.line : target?.line,
        column: result?.ok ? result.column : target?.column
      },
      target?.workspaceRoot ?? workspaceRoot
    ).then((next) => {
      if (!next.ok) {
        void window.dsGui?.logError?.('editor-open', 'Failed to open previewed file', {
          message: next.message,
          target
        })?.catch(() => undefined)
      }
    })
  }

  const copyPath = async (): Promise<void> => {
    const path = result?.ok ? result.path : target?.path
    if (!path || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside
      className={`ds-no-drag ds-code-sidebar flex min-h-0 flex-col border-l border-ds-border-muted ${className ?? ''}`}
    >
      <div className="ds-code-sidebar-topbar">
        <button
          type="button"
          onDoubleClick={openInEditor}
          className="ds-code-sidebar-tab"
          title={displayPath}
          disabled={!target}
        >
          <span className="ds-code-sidebar-file-badge">{badge}</span>
          <span className="truncate">{currentFileName}</span>
        </button>

        <div className="ds-code-sidebar-actions">
          <button
            type="button"
            onClick={openInEditor}
            disabled={!target}
            className="ds-code-sidebar-icon-button"
            title={t('filePreviewOpenEditor')}
            aria-label={t('filePreviewOpenEditor')}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => void copyPath()}
            disabled={!target}
            className="ds-code-sidebar-icon-button"
            title={copied ? t('copySuccess') : t('filePreviewCopyPath')}
            aria-label={copied ? t('copySuccess') : t('filePreviewCopyPath')}
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" strokeWidth={2} />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ds-code-sidebar-icon-button"
            title={t('rightPanelCollapse')}
            aria-label={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
      </div>

      <div className="ds-code-sidebar-breadcrumbs">
        <div className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden">
          {breadcrumbSegments.length ? breadcrumbSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="contents">
              {index > 0 ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint/70" strokeWidth={1.8} />
              ) : null}
              <span
                className={[
                  'truncate',
                  index === breadcrumbSegments.length - 1 ? 'text-ds-ink' : 'text-ds-muted'
                ].join(' ')}
                title={segment}
              >
                {segment}
              </span>
            </span>
          )) : (
            <span className="truncate text-ds-muted">{t('filePreviewEmpty')}</span>
          )}
        </div>
        {result?.ok ? (
          <span className="shrink-0 font-mono text-[10px] text-ds-faint">
            {formatBytes(result.size)}
            {language ? ` · ${language}` : ''}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!target ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-ds-muted">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ds-border-muted text-ds-faint">
                <FileCode2 className="h-5 w-5" strokeWidth={1.7} />
              </div>
              {t('filePreviewEmpty')}
            </div>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            {t('filePreviewLoading')}
          </div>
        ) : result?.ok ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {result.truncated ? (
              <div className="shrink-0 border-b border-ds-border-muted/70 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                {t('filePreviewTruncated')}
              </div>
            ) : null}
            <div
              ref={scrollRef}
              className="ds-file-preview-scroll min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[22px] text-ds-ink"
            >
              <div
                className="ds-file-preview-code-surface"
                style={codeSurfaceStyle}
              >
                {activeLine ? (
                  <div className="ds-file-preview-active-line" aria-hidden="true" />
                ) : null}
                <div className="ds-file-preview-gutter">
                  {lines.map((_, index) => {
                    const lineNo = index + 1
                    return (
                      <div
                        key={lineNo}
                        data-line={lineNo}
                        className={`ds-file-preview-line-number ${activeLine === lineNo ? 'is-active' : ''}`}
                      >
                        {lineNo}
                      </div>
                    )
                  })}
                </div>
                <div
                  className="ds-file-preview-code-html"
                  dangerouslySetInnerHTML={{ __html: highlightHtml }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-red-700 dark:text-red-300">
            {result?.message ?? t('filePreviewFailed')}
          </div>
        )}
      </div>
    </aside>
  )
}
