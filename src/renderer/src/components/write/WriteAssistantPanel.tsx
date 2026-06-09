import type { ReactElement } from 'react'
import {
  FileText,
  ListTodo,
  MessageSquareQuote,
  PanelRightClose,
  Plus,
  Sparkles,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import type { ModelProviderModelGroup } from '@shared/ds-gui-api'
import {
  useWriteWorkspaceStore,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { MessageTimeline } from '../chat/MessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'

type Props = {
  input: string
  setInput: (value: string) => void
  mode: 'plan' | 'agent'
  setMode: (value: 'plan' | 'agent') => void
  busy: boolean
  runtimeConnection: RuntimeConnectionStatus
  activeThreadId: string | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  composerModel: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  setComposerModel: (modelId: string) => void
  setComposerReasoningEffort: (effort: ComposerReasoningEffort) => void
  queuedMessages: QueuedUserMessage[]
  removeQueuedMessage: (id: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onRetryConnection: () => void
  onOpenSettings: () => void
  onNewConversation: () => void
  onCollapse: () => void
  className?: string
}

export function WriteAssistantPanel({
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeConnection,
  activeThreadId,
  blocks,
  liveReasoning,
  liveAssistant,
  composerModel,
  composerPickList,
  composerModelGroups = [],
  composerReasoningEffort,
  setComposerModel,
  setComposerReasoningEffort,
  queuedMessages,
  removeQueuedMessage,
  onSend,
  onInterrupt,
  onRetryConnection,
  onOpenSettings,
  onNewConversation,
  onCollapse,
  className = ''
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const {
    workspaceRoot,
    activeFilePath,
    selection,
    quotedSelections,
    quoteCurrentSelection,
    removeQuotedSelection
  } = useWriteWorkspaceStore()
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const canCreateConversation = runtimeConnection === 'ready' && !busy
  const hasTimeline =
    blocks.length > 0 || liveReasoning.trim().length > 0 || liveAssistant.trim().length > 0

  const setAssistantPrompt = (prompt: string): void => {
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }

  const quoteSelectionForAssistant = (): void => {
    if (!workspaceRoot.trim()) return
    quoteCurrentSelection(workspaceRoot)
    if (!input.trim()) setInput(t('writeAssistantPolishSelectionPrompt'))
  }

  return (
    <aside
      className={`write-assistant-panel ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white backdrop-blur-xl dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-ds-surface-subtle px-3 py-1.5 dark:bg-white/8">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
              {t('writeAssistant')}
            </span>
          </div>
          <button
            type="button"
            onClick={onNewConversation}
            disabled={!canCreateConversation}
            className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('writeAssistantNewConversation')}
            title={t('writeAssistantNewConversation')}
          >
            <Plus className="h-4 w-4" strokeWidth={2.1} />
          </button>
        </div>
        <div className="min-w-0 px-4 pb-3">
          <div className="truncate rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 py-1.5 text-[11.5px] font-medium text-ds-muted dark:bg-white/6">
            {activeFileLabel}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-ds-main/45 dark:bg-transparent">
        {hasTimeline ? (
          <MessageTimeline
            blocks={blocks}
            liveReasoning={liveReasoning}
            live={liveAssistant}
            activeThreadId={activeThreadId}
            runtimeConnection={runtimeConnection}
            onRetryConnection={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={(text) => setInput(text)}
          />
        ) : (
          <div className="flex min-h-full flex-col justify-end px-5 py-5">
            <div className="mb-auto rounded-[24px] border border-ds-border bg-ds-card/95 p-4 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <Sparkles className="h-5 w-5" strokeWidth={1.9} />
              </div>
              <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
                {t('writeAssistantEmptyTitle')}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-ds-muted">
                {t('writeAssistantEmptySub')}
              </p>
            </div>

            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => setAssistantPrompt(t('writeAssistantSummarizePrompt', { file: activeFileLabel }))}
                className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-card px-3 py-3 text-left transition hover:border-accent/25 hover:bg-ds-hover"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <FileText className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantSummarize')}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantSummarizeSub')}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAssistantPrompt(t('writeAssistantOutlinePrompt', { file: activeFileLabel }))}
                className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-card px-3 py-3 text-left transition hover:border-accent/25 hover:bg-ds-hover"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <ListTodo className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantOutline')}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantOutlineSub')}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selection.charCount > 0) {
                    quoteSelectionForAssistant()
                  } else {
                    setAssistantPrompt(t('writeAssistantPolishSelectionPrompt'))
                  }
                }}
                className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-card px-3 py-3 text-left transition hover:border-accent/25 hover:bg-ds-hover"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                  <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantPolishSelection')}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantPolishSelectionSub')}</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ds-border-muted bg-white/92 px-4 pb-4 pt-3 dark:bg-ds-card">
        {quotedSelections.length > 0 ? (
          <div className="mb-3 flex flex-col gap-1.5">
            {quotedSelections.map((quote) => (
              <div
                key={quote.id}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-[12px] text-ds-muted"
              >
                <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">
                  {quote.sourceTitle}
                  {quote.lineStart != null && quote.lineEnd != null ? ` · ${quote.lineStart}-${quote.lineEnd}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => removeQuotedSelection(quote.id)}
                  className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  title={t('writeRemoveQuote')}
                  aria-label={t('writeRemoveQuote')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <FloatingComposer
          variant="compact"
          workspaceRootOverride={workspaceRoot}
          input={input}
          setInput={setInput}
          mode={mode}
          setMode={setMode}
          busy={busy}
          runtimeReady={runtimeConnection === 'ready'}
          hasActiveThread={Boolean(activeThreadId)}
          composerModel={composerModel}
          composerPickList={composerPickList}
          composerModelGroups={composerModelGroups}
          composerReasoningEffort={composerReasoningEffort}
          onComposerModelChange={setComposerModel}
          onComposerReasoningEffortChange={setComposerReasoningEffort}
          modelPickerMode="combobox"
          queuedMessages={queuedMessages}
          onRemoveQueuedMessage={removeQueuedMessage}
          onSend={onSend}
          onInterrupt={onInterrupt}
        />
      </div>
    </aside>
  )
}
