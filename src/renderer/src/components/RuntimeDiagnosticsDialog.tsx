import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  RefreshCw,
  Save,
  Stethoscope,
  X
} from 'lucide-react'
import type {
  DeepseekRuntimeDiagnosticIssue,
  DeepseekRuntimeDiagnosticsResult
} from '@shared/ds-gui-api'

type Props = {
  open: boolean
  lastError: string | null
  onClose: () => void
  onRetry: () => void | Promise<void>
  onOpenSettings: () => void
}

type RuntimeSettingsDraft = {
  autoStart: boolean
  port: number
  baseUrl: string
  binaryPath: string
  apiKey: string
}

type Notice = { tone: 'success' | 'error' | 'info'; message: string }

function issueTone(issue: DeepseekRuntimeDiagnosticIssue): string {
  if (issue.severity === 'error') {
    return 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-100'
  }
  if (issue.severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100'
  }
  return 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/35 dark:text-sky-100'
}

function issueIcon(issue: DeepseekRuntimeDiagnosticIssue): ReactElement {
  if (issue.severity === 'error' || issue.severity === 'warning') {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
  }
  return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
}

function responseSummary(
  result: DeepseekRuntimeDiagnosticsResult['runtime']['health'] | NonNullable<DeepseekRuntimeDiagnosticsResult['runtime']['threadApi']> | null
): string {
  if (!result) return ''
  if (result.ok) return `${result.status} OK`
  return result.message || result.body || `${result.status || 0}`
}

function normalizeErrorText(value: string | null): string {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as { error?: string; message?: string }
    return [parsed.error, parsed.message].filter(Boolean).join(': ')
  } catch {
    return value
      .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim()
  }
}

export function RuntimeDiagnosticsDialog({
  open,
  lastError,
  onClose,
  onRetry,
  onOpenSettings
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const [diagnostics, setDiagnostics] = useState<DeepseekRuntimeDiagnosticsResult | null>(null)
  const [configText, setConfigText] = useState('')
  const [settingsDraft, setSettingsDraft] = useState<RuntimeSettingsDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const lastErrorText = useMemo(() => normalizeErrorText(lastError), [lastError])

  const loadDiagnostics = useCallback(async () => {
    if (typeof window.dsGui?.diagnoseDeepseekRuntime !== 'function') return
    setLoading(true)
    setNotice(null)
    try {
      const result = await window.dsGui.diagnoseDeepseekRuntime()
      setDiagnostics(result)
      setConfigText(result.config.content)
      setSettingsDraft({
        autoStart: result.settings.autoStart,
        port: result.settings.port,
        baseUrl: result.settings.baseUrl,
        binaryPath: result.settings.binaryPath,
        apiKey: ''
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadDiagnostics()
  }, [loadDiagnostics, open])

  const dirtyConfig = diagnostics != null && configText !== diagnostics.config.content
  const dirtySettings =
    diagnostics != null &&
    settingsDraft != null &&
    (settingsDraft.autoStart !== diagnostics.settings.autoStart ||
      settingsDraft.port !== diagnostics.settings.port ||
      settingsDraft.baseUrl !== diagnostics.settings.baseUrl ||
      settingsDraft.binaryPath !== diagnostics.settings.binaryPath ||
      settingsDraft.apiKey.trim().length > 0)
  const portValid =
    settingsDraft != null &&
    Number.isInteger(settingsDraft.port) &&
    settingsDraft.port >= 1 &&
    settingsDraft.port <= 65_535
  const canSave = portValid && (dirtyConfig || dirtySettings)

  const saveChanges = async (): Promise<boolean> => {
    if (!diagnostics || !settingsDraft || typeof window.dsGui === 'undefined') return false
    setBusy(true)
    setNotice(null)
    try {
      if (!portValid) {
        setNotice({ tone: 'error', message: tSettings('portInvalid') })
        return false
      }
      if (dirtySettings) {
        const runtimePatch: {
          autoStart: boolean
          port: number
          baseUrl: string
          binaryPath: string
          apiKey?: string
        } = {
          autoStart: settingsDraft.autoStart,
          port: settingsDraft.port,
          baseUrl: settingsDraft.baseUrl,
          binaryPath: settingsDraft.binaryPath
        }
        if (settingsDraft.apiKey.trim()) {
          runtimePatch.apiKey = settingsDraft.apiKey.trim()
        }
        await window.dsGui.setSettings({
          agents: { codewhale: runtimePatch }
        })
      }
      if (dirtyConfig) {
        await window.dsGui.setDeepseekConfigFile(configText)
      }
      setNotice({ tone: 'success', message: t('runtimeDiagnosticsSaved') })
      await loadDiagnostics()
      return true
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveAndRetry = async (): Promise<void> => {
    const saved = canSave ? await saveChanges() : true
    if (!saved) return
    setBusy(true)
    setNotice({ tone: 'info', message: t('runtimeDiagnosticsRetrying') })
    try {
      await onRetry()
      await loadDiagnostics()
    } finally {
      setBusy(false)
    }
  }

  const openConfigDir = async (): Promise<void> => {
    if (typeof window.dsGui?.openDeepseekConfigDir !== 'function') return
    const result = await window.dsGui.openDeepseekConfigDir()
    if (!result.ok) {
      setNotice({ tone: 'error', message: result.message ?? t('runtimeDiagnosticsOpenDirFailed') })
    }
  }

  if (!open) return null

  const issues = diagnostics?.issues ?? []
  const hasErrors = issues.some((issue) => issue.severity === 'error')
  const binarySummary = diagnostics
    ? diagnostics.binary.ok
      ? diagnostics.binary.path
      : diagnostics.binary.message
    : '-'

  return (
    <div className="ds-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-ds-border bg-ds-elevated shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ds-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-accent" strokeWidth={1.7} />
              <h2 className="text-[18px] font-semibold text-ds-ink">{t('runtimeDiagnosticsTitle')}</h2>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ds-muted">
              {t('runtimeDiagnosticsSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('close')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !diagnostics ? (
            <div className="flex min-h-72 items-center justify-center text-ds-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('runtimeDiagnosticsLoading')}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]">
              <section className="flex min-w-0 flex-col gap-4">
                {notice ? (
                  <div
                    className={`rounded-xl border px-3 py-2 text-[13px] leading-5 ${
                      notice.tone === 'error'
                        ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-100'
                        : notice.tone === 'success'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100'
                          : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/35 dark:text-sky-100'
                    }`}
                  >
                    {notice.message}
                  </div>
                ) : null}

                {lastErrorText ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-900 dark:text-amber-100">
                      {t('runtimeDiagnosticsLastError')}
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-[12px] leading-5 text-amber-950 dark:bg-black/20 dark:text-amber-100">
                      {lastErrorText}
                    </pre>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-ds-border bg-ds-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-semibold text-ds-ink">{t('runtimeDiagnosticsFindings')}</p>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        hasErrors
                          ? 'bg-red-500/12 text-red-700 dark:text-red-200'
                          : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-200'
                      }`}
                    >
                      {hasErrors ? t('runtimeDiagnosticsNeedsAttention') : t('runtimeDiagnosticsLooksOk')}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {issues.length ? (
                      issues.map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={`rounded-xl border p-3 ${issueTone(issue)}`}>
                          <div className="flex gap-2">
                            {issueIcon(issue)}
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold">{issue.title}</p>
                              <p className="mt-1 text-[12px] leading-5 opacity-90">{issue.message}</p>
                              {issue.path ? (
                                <p className="mt-1 break-all font-mono text-[11px] opacity-75">
                                  {issue.path}
                                  {issue.line ? `:${issue.line}` : ''}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100">
                        {t('runtimeDiagnosticsNoIssues')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-ds-border bg-ds-card p-3">
                  <p className="text-[13px] font-semibold text-ds-ink">{t('runtimeDiagnosticsStatus')}</p>
                  <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px] leading-5">
                    <dt className="text-ds-muted">{tSettings('port')}</dt>
                    <dd className="min-w-0 text-ds-ink">{diagnostics?.settings.port ?? '-'}</dd>
                    <dt className="text-ds-muted">URL</dt>
                    <dd className="min-w-0 break-all text-ds-ink">{diagnostics?.runtime.baseUrl ?? '-'}</dd>
                    <dt className="text-ds-muted">{t('runtimeDiagnosticsHealth')}</dt>
                    <dd className="min-w-0 break-words text-ds-ink">{responseSummary(diagnostics?.runtime.health ?? null) || '-'}</dd>
                    <dt className="text-ds-muted">{t('runtimeDiagnosticsThreadApi')}</dt>
                    <dd className="min-w-0 break-words text-ds-ink">{responseSummary(diagnostics?.runtime.threadApi ?? null) || '-'}</dd>
                    <dt className="text-ds-muted">{t('runtimeDiagnosticsBinary')}</dt>
                    <dd className="min-w-0 break-all text-ds-ink">
                      {binarySummary}
                    </dd>
                    <dt className="text-ds-muted">{t('runtimeDiagnosticsPortOwner')}</dt>
                    <dd className="min-w-0 break-all text-ds-ink">
                      {diagnostics?.runtime.portOwner
                        ? `PID ${diagnostics.runtime.portOwner.pid}: ${diagnostics.runtime.portOwner.command}`
                        : t('runtimeDiagnosticsNoPortOwner')}
                    </dd>
                  </dl>
                </div>
              </section>

              <section className="flex min-w-0 flex-col gap-4">
                <div className="rounded-2xl border border-ds-border bg-ds-card p-3">
                  <p className="text-[13px] font-semibold text-ds-ink">{t('runtimeDiagnosticsSettings')}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 text-[13px] text-ds-ink">
                      <input
                        type="checkbox"
                        checked={settingsDraft?.autoStart ?? false}
                        onChange={(event) =>
                          setSettingsDraft((draft) =>
                            draft ? { ...draft, autoStart: event.target.checked } : draft
                          )
                        }
                      />
                      {tSettings('autoStart')}
                    </label>
                    <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                      {tSettings('port')}
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={settingsDraft?.port ?? 7878}
                        onChange={(event) =>
                          setSettingsDraft((draft) =>
                            draft ? { ...draft, port: Number(event.target.value) } : draft
                          )
                        }
                        className="mt-1 w-full rounded-xl border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                      {!portValid ? (
                        <span className="mt-1 block text-[11px] text-red-600 dark:text-red-300">
                          {tSettings('portInvalid')}
                        </span>
                      ) : null}
                    </label>
                    <label className="min-w-0 text-[12px] font-medium text-ds-muted sm:col-span-2">
                      {tSettings('apiKey')}
                      <input
                        type="password"
                        value={settingsDraft?.apiKey ?? ''}
                        onChange={(event) =>
                          setSettingsDraft((draft) =>
                            draft ? { ...draft, apiKey: event.target.value } : draft
                          )
                        }
                        placeholder={
                          diagnostics?.settings.hasApiKey
                            ? t('runtimeDiagnosticsApiKeyConfigured')
                            : t('runtimeDiagnosticsApiKeyPlaceholder')
                        }
                        className="mt-1 w-full rounded-xl border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    </label>
                    <label className="min-w-0 text-[12px] font-medium text-ds-muted sm:col-span-2">
                      {tSettings('baseUrl')}
                      <input
                        value={settingsDraft?.baseUrl ?? ''}
                        onChange={(event) =>
                          setSettingsDraft((draft) =>
                            draft ? { ...draft, baseUrl: event.target.value } : draft
                          )
                        }
                        className="mt-1 w-full rounded-xl border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    </label>
                    <label className="min-w-0 text-[12px] font-medium text-ds-muted sm:col-span-2">
                      {tSettings('deepseekBinary')}
                      <input
                        value={settingsDraft?.binaryPath ?? ''}
                        onChange={(event) =>
                          setSettingsDraft((draft) =>
                            draft ? { ...draft, binaryPath: event.target.value } : draft
                          )
                        }
                        placeholder={tSettings('deepseekBinaryPlaceholder')}
                        className="mt-1 w-full rounded-xl border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex min-h-[420px] flex-col rounded-2xl border border-ds-border bg-ds-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ds-ink">{t('runtimeDiagnosticsConfig')}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-ds-muted">
                        {diagnostics?.config.path ?? '~/.deepseek/config.toml'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openConfigDir()}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-elevated px-3 py-2 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {tSettings('mcpOpenDir')}
                    </button>
                  </div>
                  <textarea
                    value={configText}
                    onChange={(event) => setConfigText(event.target.value)}
                    spellCheck={false}
                    className="mt-3 min-h-0 flex-1 resize-none rounded-xl border border-ds-border bg-ds-elevated px-3 py-3 font-mono text-[12px] leading-5 text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                  />
                </div>
              </section>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ds-border px-5 py-4">
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            {t('openSettings')}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDiagnostics()}
              disabled={loading || busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('runtimeDiagnosticsRunAgain')}
            </button>
            <button
              type="button"
              onClick={() => void saveChanges()}
              disabled={!canSave || busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Save className="h-3.5 w-3.5" />
              {t('runtimeDiagnosticsSave')}
            </button>
            <button
              type="button"
              onClick={() => void saveAndRetry()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('runtimeDiagnosticsSaveRetry')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
