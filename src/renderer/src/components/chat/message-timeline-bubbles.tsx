import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Copy, FileEdit, ImageIcon, Loader2, MessageSquareQuote, PencilLine, Terminal, Wrench } from 'lucide-react'
import type { AttachmentReference, ChatBlock, RuntimeDisclosureMetadata, ToolBlock, UserInputAnswer, UserInputQuestion } from '../../agent/types'
import { extractUnifiedDiffText } from '../../lib/diff-stats'
import { useChatStore } from '../../store/chat-store'
import { getProvider } from '../../agent/registry'
import { parseWritePromptForDisplay } from '../../write/quoted-selection'
import { parseClawUserPromptForDisplay, type ClawUserPromptDisplay } from '@shared/app-settings'
import { DiffView } from '../DiffView'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ModelMetaTag, WritePromptMetaDisclosure } from './message-timeline-cards'
import { readNumber, formatDuration, formatToolTitle } from './message-timeline-tools'

const COPY_FEEDBACK_RESET_MS = 1600

/**
 * User message bubble with hover affordance to rewind/edit. Click the rewind
 * pill, the bubble flips into a textarea, and Resend submits an edited
 * version of the message — locally truncating subsequent turns and starting
 * a fresh turn on the same thread (see chat-store `rewindAndResend`).
 */
function UserMessageBubble({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const route = useChatStore((s) => s.route)
  const rewindAndResend = useChatStore((s) => s.rewindAndResend)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.text)
  const [writeMetaOpen, setWriteMetaOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const parsedWritePrompt = useMemo(() => {
    if (route !== 'write') return null
    const parsed = parseWritePromptForDisplay(block.text)
    return parsed?.userInput.trim() ? parsed : null
  }, [block.text, route])
  const parsedClawPrompt = useMemo(() => {
    const parsed = parseClawUserPromptForDisplay(block.text)
    if (!parsed.managed && !parsed.inbound && block.managedBy !== 'claw' && route !== 'claw') return null
    return parsed
  }, [block.managedBy, block.text, route])
  const metaDisplayText =
    typeof block.meta?.displayText === 'string' && block.meta.displayText.trim()
      ? block.meta.displayText.trim()
      : null
  const displayText = metaDisplayText ?? parsedWritePrompt?.userInput ?? parsedClawPrompt?.text ?? block.text
  const canEdit = !metaDisplayText
  const showClawInboundCard = route === 'claw' && parsedClawPrompt?.inbound === true

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
    // Auto-size to content
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [editing])

  useEffect(() => {
    setWriteMetaOpen(false)
  }, [block.id])

  const startEdit = (): void => {
    if (busy || !canEdit) return
    setDraft(displayText)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setDraft(block.text)
    setEditing(false)
  }

  const submit = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (!trimmed || busy) return
    setEditing(false)
    await rewindAndResend(block.id, trimmed)
  }

  if (editing) {
    return (
      <div className="ds-user-message">
        <UserAttachmentPreviews meta={block.meta} />
        <div className="ds-user-message-bubble min-w-0 border border-accent/35 ring-1 ring-accent/15">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 360)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={2}
            className="block w-full min-w-0 resize-none break-words bg-transparent text-[15px] font-medium leading-[1.58] text-ds-ink outline-none [overflow-wrap:anywhere]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12px] text-ds-faint">{t('rewindHint')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md px-3 py-1 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('rewindCancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || busy}
                className="rounded-md bg-accent px-3 py-1 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('rewindResend')}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-end">
          <ModelMetaTag label={block.modelLabel} />
        </div>
      </div>
    )
  }

  return (
    <div className="ds-user-message group relative">
      <UserAttachmentPreviews meta={block.meta} />
      {showClawInboundCard && parsedClawPrompt ? (
        <ClawInboundMessageCard display={parsedClawPrompt} text={displayText} />
      ) : (
        <div className="ds-user-message-bubble min-w-0">
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left">
            {displayText}
          </div>
          {parsedWritePrompt ? (
            <WritePromptMetaDisclosure
              display={parsedWritePrompt}
              expanded={writeMetaOpen}
              onToggle={() => setWriteMetaOpen((value) => !value)}
            />
          ) : null}
          <RuntimeMetaChips meta={block.meta} align="right" hideAttachments />
        </div>
      )}
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-ds-faint opacity-90 transition group-hover:opacity-100">
        <ModelMetaTag label={block.modelLabel} className="flex-1 justify-start text-left" />
        <div className="flex items-center justify-end gap-3">
          <CopyFeedbackButton text={displayText} iconOnly />
          {canEdit ? (
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              title={t('rewindEditMessage')}
              aria-label={t('rewindEditMessage')}
              className="rounded-md p-1 transition hover:bg-ds-hover hover:text-ds-muted disabled:cursor-not-allowed disabled:hover:text-ds-faint"
            >
              <PencilLine className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ClawInboundMessageCard({
  display,
  text
}: {
  display: ClawUserPromptDisplay
  text: string
}): ReactElement {
  const { t } = useTranslation('common')
  const meta = [
    display.sender ? t('clawTimelineSender', { sender: display.sender }) : '',
    display.chatType ? t('clawTimelineChatType', { chatType: display.chatType }) : '',
    display.messageType ? t('clawTimelineMessageType', { messageType: display.messageType }) : '',
    display.mentions ? t('clawTimelineMentions', { mentions: display.mentions }) : ''
  ].filter(Boolean)

  return (
    <div className="w-full max-w-[min(560px,calc(100vw-3rem))] rounded-[18px] border border-ds-border bg-ds-card px-4 py-3 text-left shadow-[0_14px_34px_rgba(86,103,136,0.08)]">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-ds-muted">
        <MessageSquareQuote className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>{t('clawTimelineInbound', { source: display.sourceLabel ?? t('claw') })}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-ds-ink [overflow-wrap:anywhere]">
        {text}
      </div>
      {meta.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meta.map((item) => (
            <span
              key={item}
              className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11px] text-ds-muted"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const USER_INPUT_OTHER_LABEL = 'Other'

function metaStringArray(meta: Record<string, unknown> | undefined, key: string): string[] {
  const value = meta?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function metaAttachmentReferences(meta: RuntimeDisclosureMetadata | undefined): AttachmentReference[] {
  const value = meta?.attachments
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
      if (!id) return null
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined
      const mimeType = typeof raw.mimeType === 'string' && raw.mimeType.trim() ? raw.mimeType.trim() : undefined
      const previewUrl = typeof raw.previewUrl === 'string' && raw.previewUrl.trim() ? raw.previewUrl.trim() : undefined
      const width = typeof raw.width === 'number' && Number.isFinite(raw.width) ? raw.width : undefined
      const height = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : undefined
      return {
        id,
        ...(name ? { name } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(previewUrl ? { previewUrl } : {})
      }
    })
    .filter((entry): entry is AttachmentReference => entry !== null)
}

function UserAttachmentPreviews({
  meta
}: {
  meta?: RuntimeDisclosureMetadata
}): ReactElement | null {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const attachments = useMemo(() => {
    const attachmentIds = metaStringArray(meta, 'attachmentIds')
    const byId = new Map<string, AttachmentReference>()
    for (const attachment of metaAttachmentReferences(meta)) {
      byId.set(attachment.id, attachment)
    }
    for (const id of attachmentIds) {
      if (!byId.has(id)) byId.set(id, { id })
    }
    return [...byId.values()]
  }, [meta])
  const [resolvedPreviewUrls, setResolvedPreviewUrls] = useState<Record<string, string>>({})
  const [failedPreviewIds, setFailedPreviewIds] = useState<Record<string, true>>({})
  const missingPreviewKey = attachments
    .filter((attachment) => !attachment.previewUrl && !resolvedPreviewUrls[attachment.id] && !failedPreviewIds[attachment.id])
    .map((attachment) => attachment.id)
    .join('\n')

  useEffect(() => {
    if (!missingPreviewKey) return
    const provider = getProvider()
    if (typeof provider.getAttachmentContent !== 'function') return
    const missingIds = missingPreviewKey.split('\n').filter(Boolean)
    let cancelled = false
    void Promise.all(
      missingIds.map(async (id) => {
        try {
          const content = await provider.getAttachmentContent?.(id, {
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspaceRoot ? { workspace: workspaceRoot } : {})
          })
          if (!content) return { id, failed: true as const }
          return {
            id,
            previewUrl: `data:${content.attachment.mimeType};base64,${content.dataBase64}`
          }
        } catch {
          return { id, failed: true as const }
        }
      })
    ).then((results) => {
      if (cancelled) return
      setResolvedPreviewUrls((current) => {
        const next = { ...current }
        for (const result of results) {
          if ('previewUrl' in result && typeof result.previewUrl === 'string') {
            next[result.id] = result.previewUrl
          }
        }
        return next
      })
      setFailedPreviewIds((current) => {
        const next = { ...current }
        for (const result of results) {
          if ('failed' in result) next[result.id] = true
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeThreadId, missingPreviewKey, workspaceRoot])

  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex min-w-0 justify-end">
      <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
        {attachments.map((attachment) => {
          const previewUrl = attachment.previewUrl ?? resolvedPreviewUrls[attachment.id]
          const title = attachment.name || attachment.id
          return (
            <span
              key={attachment.id}
              className="block h-28 w-36 overflow-hidden rounded-[14px] border border-ds-border-muted bg-ds-card shadow-sm"
              title={title}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-ds-faint">
                  <ImageIcon className="h-7 w-7" strokeWidth={1.6} />
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function metaSources(meta: Record<string, unknown> | undefined): Array<{ title?: string; url?: string }> {
  const value = meta?.sources
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
      const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
      return title || url ? { ...(title ? { title } : {}), ...(url ? { url } : {}) } : null
    })
    .filter((entry): entry is { title?: string; url?: string } => entry !== null)
}

function RuntimeMetaChips({
  meta,
  align = 'left',
  hideAttachments = false
}: {
  meta?: Record<string, unknown>
  align?: 'left' | 'right'
  hideAttachments?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const attachmentIds = metaStringArray(meta, 'attachmentIds')
  const activeSkillIds = metaStringArray(meta, 'activeSkillIds')
  const injectedMemoryIds = metaStringArray(meta, 'injectedMemoryIds')
  const sources = metaSources(meta)
  const child = meta?.child && typeof meta.child === 'object' ? meta.child as Record<string, unknown> : null
  const childLabel =
    typeof child?.childLabel === 'string' && child.childLabel.trim()
      ? child.childLabel.trim()
      : typeof child?.childId === 'string'
        ? child.childId
        : ''
  if (
    (hideAttachments || attachmentIds.length === 0) &&
    activeSkillIds.length === 0 &&
    injectedMemoryIds.length === 0 &&
    sources.length === 0 &&
    !childLabel
  ) {
    return null
  }
  const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint'
  return (
    <div className={`mt-2 flex min-w-0 flex-wrap gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
      {!hideAttachments && attachmentIds.length > 0 ? (
        <span className={chipClass} title={attachmentIds.join(', ')}>
          {t('toolAttachments')} {attachmentIds.length}
        </span>
      ) : null}
      {activeSkillIds.length > 0 ? (
        <span className={chipClass} title={activeSkillIds.join(', ')}>
          {t('toolActiveSkills')} {activeSkillIds.length}
        </span>
      ) : null}
      {injectedMemoryIds.length > 0 ? (
        <span className={chipClass} title={injectedMemoryIds.join(', ')}>
          {t('toolInjectedMemories')} {injectedMemoryIds.length}
        </span>
      ) : null}
      {childLabel ? (
        <span className={chipClass} title={childLabel}>
          {t('toolChildAgent')} <span className="max-w-28 truncate font-mono text-ds-muted">{childLabel}</span>
        </span>
      ) : null}
      {sources.slice(0, 4).map((source, index) =>
        source.url ? (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={chipClass}
            title={source.url}
          >
            {t('toolSources')} {index + 1}
          </a>
        ) : (
          <span key={`${source.title}-${index}`} className={chipClass} title={source.title}>
            {t('toolSources')} {index + 1}
          </span>
        )
      )}
    </div>
  )
}

function CopyFeedbackButton({
  text,
  iconOnly = false
}: {
  text: string
  iconOnly?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const resetRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    },
    []
  )

  const scheduleReset = (): void => {
    if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    resetRef.current = window.setTimeout(() => {
      setStatus('idle')
      resetRef.current = null
    }, COPY_FEEDBACK_RESET_MS)
  }

  const handleCopy = async (): Promise<void> => {
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('success')
    } catch {
      setStatus('error')
    }
    scheduleReset()
  }

  const success = status === 'success'
  const error = status === 'error'
  const label = success ? t('copySuccess') : error ? t('copyFailed') : t('copyMessage')
  const iconClassName = iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={label}
      aria-label={label}
      className={`flex shrink-0 items-center rounded-md transition ${
        iconOnly
          ? 'gap-0 p-1 hover:bg-ds-hover'
          : 'gap-1 px-1.5 py-0.5 hover:bg-ds-hover'
      } ${
        success
          ? 'text-emerald-500'
          : error
            ? 'text-rose-400'
            : 'text-ds-faint hover:text-ds-muted'
      }`}
    >
      {success ? (
        <Check className={iconClassName} strokeWidth={2} />
      ) : (
        <Copy className={iconClassName} strokeWidth={1.8} />
      )}
      {!iconOnly ? <span>{label}</span> : null}
    </button>
  )
}

function UserInputBubble({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user_input' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const resolveUserInput = useChatStore((s) => s.resolveUserInput)
  const [answers, setAnswers] = useState<Record<string, UserInputAnswer>>(() =>
    answersByQuestionId(block.answers)
  )
  const pending = block.status === 'pending'
  const done = block.status !== 'pending'

  useEffect(() => {
    setAnswers(answersByQuestionId(block.answers))
  }, [block.id, block.answers])

  const chooseOption = (question: UserInputQuestion, label: string, value = label): void => {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: { id: question.id, label, value }
    }))
  }

  const canSubmit = block.questions.every((question) => {
    const answer = answers[question.id]
    if (!answer) return false
    if (answer.label === USER_INPUT_OTHER_LABEL) return answer.value.trim().length > 0
    return true
  })

  const submit = (): void => {
    if (!canSubmit || !pending) return
    const ordered = block.questions.map((question) => answers[question.id]).filter(Boolean)
    void resolveUserInput(block.id, { kind: 'submit', answers: ordered })
  }

  const cancel = (): void => {
    if (!pending) return
    void resolveUserInput(block.id, { kind: 'cancel' })
  }

  const statusLabel =
    block.status === 'submitted'
      ? t('userInputSubmitted')
      : block.status === 'cancelled'
        ? t('userInputCancelled')
        : block.status === 'error'
          ? t('userInputFailed')
          : t('userInputPending')

  return (
    <div
      className={`rounded-[22px] border px-4 py-4 text-[13px] leading-6 shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${
        block.status === 'error'
          ? 'border-red-300/80 bg-red-500/10 dark:border-red-800/60 dark:bg-red-950/35'
          : 'border-accent/35 bg-[linear-gradient(180deg,rgba(79,124,255,0.07),rgba(79,124,255,0.11))] text-ds-ink'
      }`}
    >
      <div className="font-semibold text-accent">{t('userInputTitle')}</div>
      <p className="mt-1 text-[12px] text-ds-muted">{statusLabel}</p>

      <div className="mt-3 flex flex-col gap-4">
        {block.questions.map((question, index) => {
          const answer = answers[question.id]
          const otherSelected = answer?.label === USER_INPUT_OTHER_LABEL
          return (
            <div key={question.id} className="rounded-xl border border-ds-border bg-ds-card/60 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ds-muted">
                  {question.header}
                </div>
                <div className="text-[12px] text-ds-faint">
                  {t('userInputQuestionProgress', {
                    current: index + 1,
                    total: block.questions.length
                  })}
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[14px] font-medium text-ds-ink">
                {question.question}
              </p>
              <div className="mt-3 grid gap-2">
                {question.options.map((option) => {
                  const selected = answer?.label === option.label && answer.value === option.label
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={done}
                      onClick={() => chooseOption(question, option.label)}
                      className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-default ${
                        selected
                          ? 'border-accent/60 bg-accent/10 text-ds-ink'
                          : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span className="block text-[13px] font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-[12px] leading-5 text-ds-faint">
                        {option.description}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  disabled={done}
                  onClick={() =>
                    chooseOption(
                      question,
                      USER_INPUT_OTHER_LABEL,
                      answer?.label === USER_INPUT_OTHER_LABEL ? answer.value : ''
                    )
                  }
                  className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-default ${
                    otherSelected
                      ? 'border-accent/60 bg-accent/10 text-ds-ink'
                      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{t('userInputOther')}</span>
                  <span className="mt-0.5 block text-[12px] leading-5 text-ds-faint">
                    {t('userInputOtherDescription')}
                  </span>
                </button>
                {otherSelected ? (
                  <textarea
                    rows={2}
                    disabled={done}
                    value={answer?.value ?? ''}
                    onChange={(e) =>
                      chooseOption(question, USER_INPUT_OTHER_LABEL, e.target.value)
                    }
                    placeholder={t('userInputCustomPlaceholder')}
                    className="min-h-20 resize-y rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/60 disabled:cursor-default disabled:opacity-80"
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {block.errorMessage ? (
        <p className="mt-3 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
      ) : null}

      {block.answers && block.answers.length > 0 && block.status === 'submitted' ? (
        <div className="mt-3 rounded-lg bg-ds-card px-3 py-2 text-[12px] text-ds-muted">
          {block.answers.map((answer) => (
            <div key={answer.id} className="flex gap-2">
              <span className="font-mono text-ds-faint">{answer.id}</span>
              <span className="min-w-0 flex-1 break-words">{answer.value || answer.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={submit}
          >
            {t('userInputSubmit')}
          </button>
          <button
            type="button"
            className="rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink hover:bg-ds-hover"
            onClick={cancel}
          >
            {t('userInputCancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function answersByQuestionId(
  answers: UserInputAnswer[] | undefined
): Record<string, UserInputAnswer> {
  const out: Record<string, UserInputAnswer> = {}
  for (const answer of answers ?? []) {
    out[answer.id] = answer
  }
  return out
}

function formatMessageDateTime(input: string, locale: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function MessageBubble({ block, nested = false }: { block: ChatBlock; nested?: boolean }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  if (block.kind === 'user') {
    return <UserMessageBubble block={block} />
  }
  if (block.kind === 'assistant') {
    const streaming = block.id === 'live-assistant'
    const createdAtLabel = block.createdAt
      ? formatMessageDateTime(block.createdAt, i18n.language)
      : null
    return (
      <div className="group/message flex min-w-0 max-w-full flex-col">
        <div className="ds-markdown ds-chat-answer min-w-0 max-w-full text-ds-ink">
          <AssistantMarkdown text={block.text} streaming={streaming} />
        </div>
        {!streaming ? (
          <div className="mt-1 flex min-h-5 min-w-0 items-center justify-between gap-3 text-[11.5px] text-ds-faint opacity-0 transition duration-150 group-hover/message:opacity-100">
            <span className="min-w-0 truncate">{createdAtLabel ?? ''}</span>
            <CopyFeedbackButton text={block.text} />
          </div>
        ) : null}
      </div>
    )
  }
  if (block.kind === 'reasoning') {
    return (
      <div className="ds-card-soft rounded-[20px] px-4 py-3 text-[13.5px] leading-6 text-ds-muted">
        <div className="ds-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (block.kind === 'tool') {
    return <ToolEntry block={block} nested={nested} />
  }
  if (block.kind === 'user_input') {
    return <UserInputBubble block={block} />
  }
  if (block.kind === 'approval') {
    const done = block.status !== 'pending'
    const statusLabel =
      block.status === 'allowed'
        ? t('approvalAllowed')
        : block.status === 'denied'
          ? t('approvalDenied')
          : block.status === 'error'
            ? t('approvalFailed')
            : t('approvalPending')
    return (
      <div
        className={`rounded-[22px] border px-4 py-4 text-[13px] leading-6 shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${
          block.status === 'error'
            ? 'border-red-300/80 bg-red-500/10 dark:border-red-800/60 dark:bg-red-950/35'
            : 'border-accent/35 bg-[linear-gradient(180deg,rgba(79,124,255,0.08),rgba(79,124,255,0.12))] text-ds-ink'
        }`}
      >
        <div className="font-semibold text-accent">{t('approvalTitle')}</div>
        {block.toolName ? (
          <div className="mt-1 text-[12px] text-ds-muted">
            {t('approvalTool', { name: block.toolName })}
          </div>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-[14px] text-ds-ink">{block.summary}</p>
        {block.errorMessage ? (
          <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
        ) : null}
        {!done ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700"
              onClick={() => void resolveApproval(block.id, 'allow')}
            >
              {t('approvalAllow')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink hover:bg-ds-hover"
              onClick={() => void resolveApproval(block.id, 'deny')}
            >
              {t('approvalDeny')}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[12px] font-medium text-ds-muted">{statusLabel}</p>
        )}
      </div>
    )
  }
  if (block.kind === 'compaction') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.detail || block.summary}
      </div>
    )
  }
  if (block.kind === 'review') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.reviewText || block.title}
      </div>
    )
  }
  return (
    <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
      {block.text}
    </div>
  )
}

function ToolEntry({ block, nested = false }: { block: ToolBlock; nested?: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(() => block.status === 'error' || block.status === 'running')

  useEffect(() => {
    if (block.status === 'running') {
      setOpen(true)
    }
  }, [block.status, block.id])

  const effectiveOpen = block.status === 'running' ? true : open

  const tone =
    block.status === 'error'
      ? 'border-red-300/80 bg-red-500/10 text-red-950 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-100'
      : block.status === 'running'
        ? 'border-amber-300/80 bg-amber-500/10 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100'
        : 'border-ds-border bg-ds-subtle text-ds-ink'

  const Icon = block.toolKind === 'file_change' ? FileEdit : block.toolKind === 'command_execution' ? Terminal : Wrench
  const kindLabel =
    block.toolKind === 'file_change'
      ? t('toolKindFile')
      : block.toolKind === 'command_execution'
        ? t('toolKindCommand')
        : t('toolKindTool')

  const exitCode = readNumber(block.meta, 'exit_code')
  const durationMs = readNumber(block.meta, 'duration_ms')
  const sessionId = metaString(block.meta, 'session_id')
  const sessionStatus = metaString(block.meta, 'status')

  const hasDetail = !!(block.detail && block.detail.trim().length > 0)
  const patchText = block.toolKind === 'file_change' ? extractUnifiedDiffText(block.detail) : undefined
  const canExpand = hasDetail || block.status === 'running'

  return (
    <div className={`rounded-[22px] border shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${tone}`}>
      <button
        type="button"
        onClick={() => {
          if (!canExpand || block.status === 'running') return
          setOpen((v) => !v)
        }}
        className={`flex w-full items-start gap-2 px-4 py-3 text-left text-[13.5px] leading-6 ${
          canExpand && block.status !== 'running' ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-[0.12em] text-[11px] opacity-75">
              {kindLabel}
            </span>
            {block.status === 'running' ? (
              <span className="rounded-full bg-amber-200/40 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-700/30 dark:text-amber-100">
                {t('inspectorStatusRunning')}
              </span>
            ) : null}
            {typeof exitCode === 'number' ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-mono ${
                  exitCode === 0
                    ? 'bg-ds-success-soft text-ds-success'
                    : 'bg-ds-danger-soft text-ds-danger'
                }`}
              >
                exit {exitCode}
              </span>
            ) : null}
            {sessionId ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted" title={sessionId}>
                {sessionStatus === 'running' ? t('inspectorStatusRunning') : sessionStatus || 'session'} {sessionId.slice(0, 12)}
              </span>
            ) : null}
            {typeof durationMs === 'number' ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted">
                {formatDuration(durationMs)}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 break-words">
            {block.filePath ? (
              <span className="font-mono text-[12px] opacity-90">{block.filePath} — </span>
            ) : null}
            <span>{block.summary}</span>
          </div>
          <RuntimeMetaChips meta={block.meta} />
        </div>
        {canExpand ? (
          effectiveOpen ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          )
        ) : null}
      </button>
      {effectiveOpen && hasDetail ? (
        <div className="ds-panel-strip min-w-0 border-t border-ds-border-muted/60 px-4 py-3">
          {patchText !== undefined ? (
            <DiffView patch={patchText} filePath={block.filePath} />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
              {block.detail}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  )
}
