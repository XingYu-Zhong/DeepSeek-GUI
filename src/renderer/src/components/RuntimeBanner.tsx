import type { ReactElement } from 'react'

export function RuntimeBanner({
  message,
  onOpenSettings,
  onRetryConnection,
  runtimeReady,
  stageInsetClass,
  t
}: {
  message: string
  onOpenSettings: () => void
  onRetryConnection: () => void
  runtimeReady: boolean
  stageInsetClass: string
  t: (key: string) => string
}): ReactElement {
  return (
    <div className="ds-no-drag shrink-0 border-b border-amber-200/70 bg-[rgba(255,248,235,0.82)] backdrop-blur-lg dark:border-amber-800/50 dark:bg-amber-950/35">
      <div className={`${stageInsetClass} flex w-full min-w-0 items-start justify-between gap-3 py-3`}>
        <p className="min-w-0 flex-1 text-[14px] leading-6 text-amber-950 dark:text-amber-100">
          {message}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {!runtimeReady ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-amber-300/70 bg-white px-3 py-1 text-[12px] font-medium text-amber-950 transition hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
                onClick={onRetryConnection}
              >
                {t('retryConnection')}
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                onClick={onOpenSettings}
              >
                {t('openSettings')}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
