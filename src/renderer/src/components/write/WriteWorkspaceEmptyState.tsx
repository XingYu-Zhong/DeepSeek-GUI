import type { ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WriteWorkspaceEmptyState({
  error,
  onPickWorkspace
}: {
  error?: string | null
  onPickWorkspace: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div className="max-w-md rounded-[28px] border border-ds-border bg-ds-card/90 px-8 py-8 text-center shadow-[0_22px_56px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <FolderOpen className="h-6 w-6" strokeWidth={1.9} />
        </div>
        <h2 className="mt-5 text-[24px] font-semibold tracking-[-0.04em] text-ds-ink">
          {t('writeEmptyTitle')}
        </h2>
        <p className="mt-3 text-[14.5px] leading-7 text-ds-muted">
          {t('writeEmptySub')}
        </p>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-[12px] leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onPickWorkspace}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(0,136,255,0.22)] transition hover:brightness-110"
        >
          <FolderOpen className="h-4 w-4" strokeWidth={1.9} />
          {t('selectWorkspace')}
        </button>
      </div>
    </div>
  )
}
