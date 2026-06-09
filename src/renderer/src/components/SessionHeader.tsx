import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { GitFork } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../store/chat-store'
import { formatRelativeTime } from '../lib/format-relative-time'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { formatCompactNumber, formatCost, formatPercent, useThreadUsage } from '../hooks/use-thread-usage'

type Props = {
  compact?: boolean
  className?: string
}

export function SessionHeader({ compact = false, className = '' }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const threads = useChatStore((s) => s.threads)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const busy = useChatStore((s) => s.busy)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const workspaceLabel = useChatStore((s) => s.workspaceLabel)
  const renameActiveThread = useChatStore((s) => s.renameActiveThread)

  const active = threads.find((th) => th.id === activeThreadId)
  const activeWorkspaceLabel = active?.workspace
    ? workspaceLabelFromPath(active.workspace)
    : workspaceLabel
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const threadUsage = useThreadUsage(
    activeThreadId,
    runtimeConnection === 'ready',
    `${active?.updatedAt ?? ''}:${busy ? 'busy' : 'idle'}`
  )
  const forkedFromTitle = active?.forkedFromTitle?.trim() ?? ''
  const forkLabel =
    active?.forkedFromThreadId
      ? forkedFromTitle
        ? t('sessionForkedFrom', { title: forkedFromTitle })
        : t('sessionForked')
      : ''

  useEffect(() => {
    if (active) {
      setDraftTitle(active.title)
    } else {
      setDraftTitle('')
    }
    setEditing(false)
  }, [active])

  const commitTitle = (): void => {
    if (!active) {
      setEditing(false)
      return
    }
    const next = draftTitle.trim()
    if (!next || next === active.title) {
      setDraftTitle(active.title)
      setEditing(false)
      return
    }
    void renameActiveThread(next).finally(() => setEditing(false))
  }

  if (compact) {
    return (
      <div
        className={`session-header-compact ds-no-drag flex min-h-0 min-w-0 flex-1 items-center gap-2 text-left ${className}`}
      >
        {active ? (
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[13px] font-semibold leading-[18px] tracking-[-0.01em] text-ds-ink opacity-95"
              title={active.title}
            >
              {active.title}
            </div>
            <div className="session-header-compact-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] leading-[15px] text-ds-faint">
              <span className="session-meta-workspace max-w-[min(42vw,240px)] truncate">{activeWorkspaceLabel}</span>
              <span className="session-meta-workspace-separator opacity-70">·</span>
              <span className="session-meta-mode shrink-0 capitalize">{active.mode}</span>
              <span className="session-meta-mode-separator opacity-70">·</span>
              <span className="session-meta-time shrink-0 tabular-nums">
                {formatRelativeTime(active.updatedAt, i18n.language)}
              </span>
              {active.forkedFromThreadId ? (
                <>
                  <span className="session-meta-fork-separator opacity-70">·</span>
                  <span
                    className="session-meta-fork inline-flex min-w-0 max-w-[min(34vw,220px)] items-center gap-1 truncate"
                    title={forkLabel}
                  >
                    <GitFork className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">
                      {forkedFromTitle
                        ? t('sessionForkedFromCompact', { title: forkedFromTitle })
                        : t('sessionForked')}
                    </span>
                  </span>
                </>
              ) : null}
              {threadUsage ? (
                <>
                  <span className="session-meta-usage-separator opacity-70">·</span>
                  <span
                    className="session-meta-usage shrink-0 tabular-nums"
                    title={t('sessionUsageTitle', { turns: threadUsage.turns })}
                  >
                    {t('sessionUsageCompact', {
                      tokens: formatCompactNumber(threadUsage.totalTokens),
                      cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny),
                      cache: formatPercent(threadUsage.cacheHitRate)
                    })}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="min-w-0 pt-0.5">
            <div className="truncate text-[12.5px] font-medium text-ds-faint">{workspaceLabel}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`ds-no-drag flex min-h-[74px] min-w-0 flex-1 items-center gap-4 px-5 py-4 sm:px-6 ${className}`}>
      {active ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-ds-faint">
              <span>{activeWorkspaceLabel}</span>
              <span>·</span>
              <span className="capitalize">{active.mode}</span>
              <span>·</span>
              <span>{formatRelativeTime(active.updatedAt, i18n.language)}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2.5">
              {editing ? (
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-ds-border bg-ds-elevated px-3.5 py-2 text-[21px] font-semibold tracking-[-0.02em] text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => commitTitle()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTitle()
                    }
                    if (e.key === 'Escape') {
                      setDraftTitle(active.title)
                      setEditing(false)
                    }
                  }}
                  aria-label={t('renameThreadHint')}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-[22px] font-semibold tracking-[-0.03em] text-ds-ink transition hover:text-accent"
                  title={t('renameThreadHint')}
                  onClick={() => setEditing(true)}
                >
                  {active.title}
                </button>
              )}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-ds-faint">
              <span className="inline-flex items-center rounded-full border border-ds-border bg-ds-subtle px-2.5 py-1 font-medium capitalize text-ds-muted">
                {active.mode}
              </span>
              {active.workspace ? (
                <span className="truncate rounded-full border border-ds-border bg-ds-card/70 px-2.5 py-1">
                  {active.workspace.split(/[/\\]/).pop()}
                </span>
              ) : null}
              {active.forkedFromThreadId ? (
                <span
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-accent/18 bg-accent/8 px-2.5 py-1 font-medium text-accent"
                  title={forkLabel}
                >
                  <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{forkLabel}</span>
                </span>
              ) : null}
              {threadUsage ? (
                <>
                  <span
                    className="inline-flex items-center rounded-full border border-ds-border bg-ds-subtle px-2.5 py-1 font-medium text-ds-muted"
                    title={t('sessionUsageTitle', { turns: threadUsage.turns })}
                  >
                    {t('sessionUsageTokens', {
                      tokens: formatCompactNumber(threadUsage.totalTokens)
                    })}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-ds-border bg-ds-card/70 px-2.5 py-1 font-medium text-ds-muted">
                    {t('sessionUsageCost', {
                      cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny)
                    })}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full border border-ds-border bg-ds-card/70 px-2.5 py-1 font-medium text-ds-muted"
                    title={t('sessionUsageCacheTitle', {
                      cached: formatCompactNumber(threadUsage.cachedTokens),
                      miss: formatCompactNumber(threadUsage.cacheMissTokens)
                    })}
                  >
                    {t('sessionUsageCache', { cache: formatPercent(threadUsage.cacheHitRate) })}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-ds-faint">
            {workspaceLabel}
          </div>
          <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ds-ink">
            {t('noSessionSelected')}
          </div>
          <div className="mt-1 text-[13.5px] text-ds-faint">{t('sessionHeaderHint')}</div>
        </div>
      )}
      {busy ? (
        <span className="ml-auto shrink-0 rounded-full bg-amber-500/18 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 dark:text-amber-100">
          {t('running')}
        </span>
      ) : null}
    </div>
  )
}
