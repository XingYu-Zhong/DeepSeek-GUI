import type { ReactElement, RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronRight, FileEdit, Hammer, ListTodo, MessageSquareQuote, SearchCode, TriangleAlert } from 'lucide-react'
import type { ReviewBlock, ToolBlock } from '../../agent/types'
import { countDiffStats, sumDiffStats } from '../../lib/diff-stats'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import type { WritePromptDisplay, WritePromptDisplayQuote } from '../../write/quoted-selection'
import { DiffView } from '../DiffView'
import { formatDuration } from './message-timeline-tools'

/**
 * Inline "Review Plan" card rendered under a turn whose `create_plan`
 * call succeeded. Mirrors the Plan panel actions (open / build) so the
 * user can act on the plan without leaving the conversation.
 */
export function ReviewPlanCard({
  title,
  relativePath,
  busy,
  onOpen,
  onBuild
}: {
  title: string
  relativePath: string
  busy: boolean
  onOpen?: () => void
  onBuild?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      title={relativePath}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-[18px] border border-ds-border-muted bg-white/[0.78] px-4 py-3 shadow-[0_12px_34px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.045]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
        <ListTodo className="h-5 w-5" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-ds-ink">{title}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-ds-muted">{t('reviewPlanCardHint')}</div>
      </div>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover"
        >
          <FileEdit className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('reviewPlanOpen')}
        </button>
      ) : null}
      {onBuild ? (
        <button
          type="button"
          onClick={onBuild}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(0,136,255,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Hammer className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('planBuild')}
        </button>
      ) : null}
    </div>
  )
}

export function ReviewSummaryCard({ review }: { review: ReviewBlock }): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(review.status !== 'success')
  const findings = review.output?.findings ?? []
  const incorrect = review.output?.overallCorrectness === 'patch is incorrect'
  const running = review.status === 'running'
  const failed = review.status === 'error'
  const icon = running ? (
    <SearchCode className="h-5 w-5" strokeWidth={1.9} />
  ) : failed || incorrect ? (
    <TriangleAlert className="h-5 w-5" strokeWidth={1.9} />
  ) : (
    <CheckCircle2 className="h-5 w-5" strokeWidth={1.9} />
  )
  const statusText = running
    ? t('reviewCardRunning')
    : failed
      ? t('reviewCardFailed')
      : findings.length === 0
        ? t('reviewCardNoFindings')
        : t('reviewCardFindings', { count: findings.length })

  return (
    <section className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/80 shadow-[0_16px_40px_rgba(86,103,136,0.08)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-ds-hover/40"
      >
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${
          failed || incorrect
            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
            : running
              ? 'bg-accent/10 text-accent'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        }`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ds-ink">
            {review.title}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ds-muted">
            {statusText}
          </span>
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-ds-border-muted/70 px-5 py-4">
          {review.output?.overallExplanation?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
              {review.output.overallExplanation}
            </p>
          ) : review.reviewText?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
              {review.reviewText}
            </p>
          ) : (
            <p className="text-[14px] leading-6 text-ds-muted">{statusText}</p>
          )}

          {findings.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {findings.map((finding, index) => (
                <article
                  key={`${finding.title}-${index}`}
                  className="rounded-[12px] border border-ds-border-muted bg-ds-card-muted/45 px-3.5 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded-md bg-ds-card px-1.5 py-0.5 font-mono text-[11px] text-ds-muted">
                      P{finding.priority}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-[14px] font-semibold text-ds-ink">
                        {finding.title.replace(/^\[P[0-3]\]\s*/i, '')}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11.5px] text-ds-faint">
                        {finding.codeLocation.absoluteFilePath}:{finding.codeLocation.lineRange.start}
                        -{finding.codeLocation.lineRange.end}
                      </div>
                    </div>
                  </div>
                  {finding.body.trim() ? (
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-ds-muted">
                      {finding.body}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function TurnChangeSummary({
  changes,
  viewportRef
}: {
  changes: ToolBlock[]
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(
    () => changes.find((change) => change.detail?.trim())?.id ?? changes[0]?.id ?? null
  )

  useEffect(() => {
    if (changes.length === 0) {
      setActiveId(null)
      return
    }
    setActiveId((current) => {
      if (current && changes.some((change) => change.id === current)) return current
      return changes.find((change) => change.detail?.trim())?.id ?? changes[0]?.id ?? null
    })
  }, [changes])

  const totals = useMemo(() => sumDiffStats(changes.map((change) => change.detail)), [changes])
  const title = useMemo(
    () =>
      changes.length === 1
        ? t('turnChangeFilesOne')
        : t('turnChangeFilesMany', { count: changes.length }),
    [changes.length, t]
  )
  const { ref: deferredBodyRef, shouldRender: shouldRenderBody } = useDeferredRender<HTMLDivElement>({
    enabled: expanded,
    root: viewportRef
  })

  return (
    <section className="ds-card-strong overflow-hidden rounded-[24px] border border-ds-border shadow-[0_16px_40px_rgba(86,103,136,0.08)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-ds-hover/40"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-ds-card-muted text-ds-muted">
          <FileEdit className="h-5 w-5" strokeWidth={1.85} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-semibold tracking-[-0.02em] text-ds-ink">
            {title}
          </span>
          {totals ? (
            <span className="mt-1 block font-mono text-[12px]">
              <span className="text-ds-diff-added">+{totals.added}</span>
              <span className="mx-1.5 text-ds-faint">·</span>
              <span className="text-ds-diff-removed">-{totals.removed}</span>
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>

      {expanded ? (
        <div
          ref={deferredBodyRef}
          className="border-t border-ds-border-muted/70"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}
        >
          {shouldRenderBody
            ? changes.map((change) => {
            const stats = countDiffStats(change.detail)
            const open = activeId === change.id
            const primary = change.filePath ?? t('toolActionFile')

            return (
              <div key={change.id} className="border-b border-ds-border-muted/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setActiveId(open ? null : change.id)}
                  aria-expanded={open}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left transition ${
                    open ? 'bg-ds-hover/45' : 'hover:bg-ds-hover/35'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-[14px] font-medium text-ds-ink">
                      {primary}
                    </span>
                  </span>
                  {stats ? (
                    <span className="shrink-0 font-mono text-[12px] tabular-nums">
                      <span className="text-ds-diff-added">+{stats.added}</span>
                      <span className="ml-1.5 text-ds-diff-removed">-{stats.removed}</span>
                    </span>
                  ) : null}
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  )}
                </button>

                {open && change.detail ? (
                  <div className="bg-ds-card-muted/45 px-4 pb-4 pt-1">
                    <DiffView
                      patch={change.detail}
                      filePath={change.filePath}
                      maxHeight={440}
                      className="border border-ds-border-muted/70"
                    />
                  </div>
                ) : null}
              </div>
            )
          })
            : null}
        </div>
      ) : null}
    </section>
  )
}

/** Turn-level work-process summary. Details stay collapsed until the user opens them. */
export function WorkMetaRow({
  processing,
  stepCount,
  durationMs,
  reasoningDurationMs,
  expanded,
  onToggle
}: {
  processing: boolean
  stepCount: number
  durationMs?: number
  reasoningDurationMs?: number
  expanded: boolean
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')

  const mainLabel = processing
    ? typeof durationMs === 'number'
      ? `${t('processing')} ${formatDuration(durationMs)}`
      : t('processing')
    : typeof durationMs === 'number'
      ? `${t('processed')} ${formatDuration(durationMs)}`
      : t('processSteps', { count: stepCount })

  const showThoughtSuffix =
    !processing &&
    typeof reasoningDurationMs === 'number' &&
    reasoningDurationMs >= 1000

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group flex w-fit max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[15px] font-medium text-ds-muted transition hover:opacity-85"
    >
      <span className={`tabular-nums ${processing ? 'ds-shiny-text' : ''}`}>{mainLabel}</span>
      {showThoughtSuffix ? (
        <span className="text-ds-faint">
          · {t('thoughtFor', { duration: formatDuration(reasoningDurationMs!) })}
        </span>
      ) : null}
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
      ) : (
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 opacity-40 transition group-hover:opacity-65"
          strokeWidth={1.8}
        />
      )}
    </button>
  )
}

/**
 * Tiny mono "via <model>" tag rendered above the user message body. Subtle by
 * design — no pill, no ring, just faint monospaced text right-aligned at the
 * top of the bubble. Hidden when there's no model selection to surface.
 */
export function ModelMetaTag({
  label,
  className = ''
}: {
  label?: string
  className?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!label) return null
  return (
    <div
      className={`flex min-w-0 text-right ${className}`.trim()}
      title={t('turnModelBadgeTitle', { model: label })}
    >
      <span className="truncate font-mono text-[12px] tracking-tight text-ds-faint/85">
        {label}
      </span>
    </div>
  )
}

function writePromptMetaSummary(
  display: WritePromptDisplay,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const parts: string[] = []
  if (display.quotes.length > 0) {
    parts.push(t('writePromptReferencesCount', { count: display.quotes.length }))
  }
  if (display.context) {
    parts.push(t('writePromptContextShort'))
  }
  return parts.join(' · ')
}

export function WritePromptMetaDisclosure({
  display,
  expanded,
  onToggle
}: {
  display: WritePromptDisplay
  expanded: boolean
  onToggle: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const summary = writePromptMetaSummary(display, t)
  if (!summary) return null

  return (
    <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded-lg py-0.5 text-left text-[12px] font-medium text-ds-muted transition hover:text-ds-ink"
      >
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.85} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-55" strokeWidth={1.85} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-45 transition group-hover:opacity-70" strokeWidth={1.85} />
        )}
      </button>

      {expanded ? (
        <div className="mt-2 flex flex-col gap-2">
          {display.context ? (
            <div className="rounded-xl border border-black/5 bg-white/55 px-3 py-2 text-[12px] font-normal leading-5 text-ds-muted shadow-sm dark:border-white/10 dark:bg-white/6">
              <div className="font-medium text-ds-ink">{t('writePromptContextLabel')}</div>
              {display.context.activeFile ? (
                <div className="mt-1 truncate">
                  <span className="text-ds-faint">{t('writePromptActiveFile')} </span>
                  <span className="font-mono text-ds-muted">{display.context.activeFile}</span>
                </div>
              ) : null}
              {display.context.workspaceRoot ? (
                <div className="mt-0.5 truncate" title={display.context.workspaceRoot}>
                  <span className="text-ds-faint">{t('writePromptWorkspace')} </span>
                  <span className="font-mono text-ds-muted">{display.context.workspaceRoot}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {display.quotes.map((quote, index) => (
            <WritePromptQuoteCard key={`${quote.sourceTitle}-${index}`} quote={quote} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function WritePromptQuoteCard({ quote }: { quote: WritePromptDisplayQuote }): ReactElement {
  const { t } = useTranslation('common')
  const lineLabel =
    quote.lineStart != null && quote.lineEnd != null
      ? t('writePromptReferenceLines', { start: quote.lineStart, end: quote.lineEnd })
      : null

  return (
    <figure className="rounded-xl border border-accent/15 bg-accent/[0.055] px-3 py-2.5 text-left shadow-sm">
      <figcaption className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
          {quote.sourceTitle || t('writePromptReference')}
        </span>
        {lineLabel ? (
          <span className="shrink-0 rounded-full bg-white/65 px-2 py-0.5 font-mono text-[11px] text-ds-faint dark:bg-white/8">
            {lineLabel}
          </span>
        ) : null}
      </figcaption>
      <blockquote className="mt-2 max-h-36 overflow-auto border-l-2 border-accent/35 pl-3 text-[12.5px] font-normal leading-6 text-ds-muted">
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {quote.text}
        </div>
      </blockquote>
      {quote.sourceFilePath ? (
        <div className="mt-2 truncate font-mono text-[11px] font-normal text-ds-faint" title={quote.sourceFilePath}>
          {quote.sourceFilePath}
        </div>
      ) : null}
    </figure>
  )
}
