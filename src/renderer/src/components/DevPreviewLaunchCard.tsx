import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Globe2 } from 'lucide-react'
import { formatDevPreviewUrlLabel } from '../lib/dev-preview-detection'

export function DevPreviewLaunchCard({
  url,
  opened = false,
  onOpen
}: {
  url: string
  opened?: boolean
  onOpen: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex min-h-[72px] w-full items-center gap-3 rounded-[18px] border border-ds-border-muted bg-white/[0.78] px-4 py-3 shadow-[0_12px_34px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.045] dark:shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-400/20 bg-sky-500/10 text-sky-500 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-300">
        <Globe2 className="h-5 w-5" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-ds-ink">
          {t('devPreviewCardTitle')}
        </div>
        <div
          className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-ds-muted"
          title={url}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" />
          <span className="truncate">
            {t('devPreviewCardSubtitle')} · {formatDevPreviewUrlLabel(url)}
          </span>
        </div>
      </div>
      {opened ? (
        <div className="inline-flex h-9 min-w-0 max-w-[12rem] items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 text-[12.5px] font-semibold text-ds-ink dark:bg-white/[0.08]">
          <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-300" strokeWidth={2} />
          <span className="min-w-0 truncate">{t('devPreviewCardOpened')}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(0,136,255,0.22)] transition hover:brightness-110"
          title={t('devPreviewCardOpen')}
        >
          {t('devPreviewCardOpen')}
        </button>
      )}
    </div>
  )
}
