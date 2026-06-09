import { type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefObject } from 'react'
import { Loader2, MessageSquareQuote, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteInlineAgentPosition } from './write-workspace-view-utils'

type Props = {
  action: WriteInlineAgentPosition
  open: boolean
  value: string
  inFlight: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onOpen: () => void
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmitPrompt: (value: string) => void
  onApplyEdit: (value: string) => void
}

export function WriteInlineAgent({
  action,
  open,
  value,
  inFlight,
  textareaRef,
  onOpen,
  onClose,
  onValueChange,
  onSubmitPrompt,
  onApplyEdit
}: Props): ReactElement {
  const { t } = useTranslation('common')

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (inFlight) return
      onValueChange('')
      onClose()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      onApplyEdit(value)
      return
    }
    onSubmitPrompt(value)
  }

  return (
    <div
      className="write-inline-agent fixed z-50"
      data-origin={action.origin}
      data-selection-ignore="true"
      style={{ left: action.left, top: action.top, width: action.width }}
    >
      {open ? (
        <form
          className="write-inline-agent-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmitPrompt(value)
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={t('writeInlineAgentPlaceholder')}
            aria-label={t('writeInlineAgentPlaceholder')}
            spellCheck={false}
            className="write-inline-agent-input"
            disabled={inFlight}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="write-inline-agent-secondary"
            aria-label={t('writeInlineAgentSend')}
            title={t('writeInlineAgentSend')}
            disabled={!value.trim() || inFlight}
            onClick={() => onSubmitPrompt(value)}
          >
            <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="write-inline-agent-submit"
            aria-label={inFlight ? t('writeInlineEditApplying') : t('writeInlineEditApply')}
            title={inFlight ? t('writeInlineEditApplying') : t('writeInlineEditApply')}
            disabled={!value.trim() || inFlight}
            onClick={() => onApplyEdit(value)}
          >
            {inFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="write-inline-agent-trigger"
          aria-label={t('writeInlineEditOpen')}
          title={t('writeInlineEditOpen')}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.pointerType !== 'mouse') event.preventDefault()
          }}
          onPointerUp={(event) => {
            if (event.pointerType === 'mouse') return
            event.preventDefault()
            event.stopPropagation()
            onOpen()
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={onOpen}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
          <span>{t('writeInlineEditOpen')}</span>
        </button>
      )}
    </div>
  )
}
