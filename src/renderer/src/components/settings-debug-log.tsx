import type { ReactElement } from 'react'
import type { WriteInlineCompletionDebugEntry } from '@shared/write-inline-completion'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'

function formatWriteEditDebugTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

function WriteInlineEditDebugText({
  label,
  value
}: {
  label: string
  value: string
}): ReactElement {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
        {label}
      </div>
      <pre className="max-h-72 min-h-[88px] overflow-auto whitespace-pre-wrap rounded-xl border border-ds-border-muted bg-ds-main/72 p-3 font-mono text-[11.5px] leading-5 text-ds-ink">
        {value || '—'}
      </pre>
    </div>
  )
}

export function WriteDebugLogModal({
  completionEntries,
  completionSelectedId,
  loading,
  error,
  onSelectCompletion,
  onRefresh,
  onClear,
  onClose,
  t
}: {
  completionEntries: WriteInlineCompletionDebugEntry[]
  completionSelectedId: string | null
  loading: boolean
  error: string | null
  onSelectCompletion: (id: string | null) => void
  onRefresh: () => void
  onClear: () => void
  onClose: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const completionSelected =
    completionEntries.find((entry) => entry.id === completionSelectedId) ?? completionEntries[0] ?? null

  return (
    <div className="ds-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className="flex h-[min(86vh,820px)] w-[min(1180px,96vw)] min-w-0 flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-[0_26px_80px_rgba(15,23,42,0.28)]">
        <div className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-ds-border-muted px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-ds-ink">{t('writeDebugLogTitle')}</h2>
            <p className="mt-1 text-[12.5px] text-ds-muted">{t('writeDebugLogModalDesc')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {t('writeInlineEditDebugRefresh')}
            </button>
            <button type="button" onClick={onClear} disabled={loading || completionEntries.length === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('writeInlineEditDebugClear')}
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover">
              {t('close')}
            </button>
          </div>
        </div>

        {error ? (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-[12.5px] text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {completionEntries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-[13px] text-ds-muted">
            {t('writeCompletionDebugEmpty')}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-ds-border-muted lg:grid-cols-[260px_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
            <div className="min-h-0 overflow-auto py-2">
              {completionEntries.map((entry) => (
                <WriteDebugLogListButton
                  key={entry.id}
                  active={completionSelected?.id === entry.id}
                  ok={entry.ok}
                  title={`${entry.mode} · ${entry.completion || entry.errorMessage || entry.model}`}
                  subtitle={formatWriteEditDebugTime(entry.createdAt)}
                  durationMs={entry.durationMs}
                  onClick={() => onSelectCompletion(entry.id)}
                  t={t}
                />
              ))}
            </div>
            <div className="min-h-0 min-w-0 overflow-auto px-4 py-4">
              {completionSelected ? <WriteCompletionDebugDetail entry={completionSelected} t={t} /> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WriteDebugLogListButton({
  active,
  ok,
  title,
  subtitle,
  durationMs,
  onClick,
  t
}: {
  active: boolean
  ok: boolean
  title: string
  subtitle: string
  durationMs: number
  onClick: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-2.5 text-left transition ${active ? 'bg-ds-hover text-ds-ink' : 'hover:bg-ds-hover/70'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${ok ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/12 text-red-700 dark:text-red-300'}`}>
          {ok ? t('writeInlineEditDebugOk') : t('writeInlineEditDebugFailed')}
        </span>
        <span className="text-[10.5px] text-ds-faint">{durationMs}ms</span>
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium text-ds-ink">{title}</div>
      <div className="mt-1 truncate text-[11px] text-ds-faint">{subtitle}</div>
    </button>
  )
}

function WriteCompletionDebugDetail({
  entry,
  t
}: {
  entry: WriteInlineCompletionDebugEntry
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <div className="space-y-3">
      <WriteDebugMeta
        filePath={entry.currentFilePath}
        model={`${entry.model} · ${entry.mode}`}
        context={t('writeCompletionDebugContextCounts', {
          references: entry.referenceCount,
          edits: entry.recentEditCount ?? 0
        })}
        error={entry.errorMessage}
        t={t}
      />
      <WriteInlineEditDebugText label={t('writeInlineEditDebugPrompt')} value={entry.prompt} />
      <WriteInlineEditDebugText label={t('writeInlineEditDebugSuffix')} value={entry.suffix} />
      <WriteInlineEditDebugText label={t('writeCompletionDebugCompletion')} value={entry.completion} />
      <WriteInlineEditDebugText label={t('writeInlineEditDebugRawResponse')} value={entry.rawResponse} />
    </div>
  )
}

function WriteDebugMeta({
  filePath,
  model,
  context,
  error,
  t
}: {
  filePath?: string
  model: string
  context: string
  error?: string
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <div className="grid gap-2 text-[11.5px] text-ds-muted sm:grid-cols-2">
      <div className="rounded-xl border border-ds-border-muted bg-ds-main/45 px-3 py-2">
        <span className="font-semibold text-ds-ink">{t('writeInlineEditDebugModel')}</span>
        <span className="ml-2 font-mono">{model}</span>
      </div>
      <div className="rounded-xl border border-ds-border-muted bg-ds-main/45 px-3 py-2">
        <span className="font-semibold text-ds-ink">{t('writeInlineEditDebugContext')}</span>
        <span className="ml-2">{context}</span>
      </div>
      <div className="rounded-xl border border-ds-border-muted bg-ds-main/45 px-3 py-2 sm:col-span-2">
        <span className="font-semibold text-ds-ink">{t('writeInlineEditDebugFile')}</span>
        <span className="ml-2 break-all font-mono">{filePath || '—'}</span>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200 sm:col-span-2">
          {error}
        </div>
      ) : null}
    </div>
  )
}

