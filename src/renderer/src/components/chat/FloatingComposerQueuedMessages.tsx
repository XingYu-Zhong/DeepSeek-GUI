import { type ReactElement } from 'react'
import { Clock3, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type QueuedComposerMessage = {
  id: string
  text: string
  displayText?: string
}

type Props = {
  messages: QueuedComposerMessage[]
  onRemove: (id: string) => void
}

export function FloatingComposerQueuedMessages({ messages, onRemove }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  if (messages.length === 0) return null

  return (
    <div className="mb-2 rounded-[22px] border border-ds-border bg-ds-card/88 px-4 py-3 shadow-sm backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-ds-ink">
          <Clock3 className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
          <span>{t('queuedMessagesTitle', { count: messages.length })}</span>
        </div>
        <div className="text-[12px] text-ds-muted">{t('queuedMessagesHint')}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {messages.map((message, index) => (
          <div
            key={message.id}
            className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-ds-border-muted bg-ds-main/80 px-3 py-1.5 text-[13px] text-ds-ink"
          >
            <span className="shrink-0 text-ds-faint">{index + 1}.</span>
            <span className="max-w-[360px] truncate">{message.displayText ?? message.text}</span>
            <button
              type="button"
              onClick={() => onRemove(message.id)}
              className="shrink-0 rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('queuedMessageRemove')}
              title={t('queuedMessageRemove')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
