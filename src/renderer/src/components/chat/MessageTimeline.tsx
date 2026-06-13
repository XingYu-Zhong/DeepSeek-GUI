import type { ReactElement, RefObject } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { deriveTurnSections } from './derive-turn-sections'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import { GeneratedFilesPanel, MessageBubble } from './message-timeline-bubbles'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import {
  AnimatedWorkLogo,
  IKUN_WORK_LOGO_VARIANT_LABEL_KEYS,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  useIkunWorkLogoVariant,
  useWorkLogoSwimMode
} from './AnimatedWorkLogo'
import type { UiPluginLabelKey } from '@shared/ui-plugin'
import { useUiPluginWorkLabel } from '../../store/ui-plugin-store'
import {
  groupTurns,
  sameTurnContent,
  splitThink,
  stableTurnKey,
  type Turn
} from './message-timeline-turns'
import { extractPlanMetadataFromBlock } from '../../plan/plan-tool'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'

export { summarizeToolBlock } from './message-timeline-process'

type Props = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  focusModeEnabled?: boolean
  devPreviewCard?: ReactElement | null
  /** Disables the inline Review Plan card's Build action while a turn runs. */
  planActionsBusy?: boolean
  /** Runs the active plan (Build button on the inline Review Plan card). */
  onBuildPlan?: () => void
  /** Opens/focuses the Plan panel (Open button on the inline card). */
  onOpenPlan?: () => void
}

const TURN_PAGE_SIZE = 18
const AUTO_COLLAPSE_THRESHOLD = 24

export function goalTimelinePaddingClass(route: 'chat' | 'claw', hasActiveGoal: boolean): string {
  return route === 'chat' && hasActiveGoal ? 'pb-32 md:pb-40' : 'pb-10'
}

export function liveTurnProgressClass(hasActiveGoal: boolean): string {
  return hasActiveGoal
    ? 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted mb-16 md:mb-20'
    : 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted'
}

function blockScrollStamp(block: ChatBlock | undefined): string {
  if (!block) return ''
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return `${block.id}:${block.kind}:${block.text.length}`
    case 'tool':
      return `${block.id}:${block.kind}:${block.status}:${block.summary.length}:${block.detail?.length ?? 0}`
    case 'review':
      return `${block.id}:${block.kind}:${block.status}:${block.reviewText?.length ?? 0}`
    case 'approval':
    case 'user_input':
    case 'compaction':
      return `${block.id}:${block.kind}:${block.status}`
    default:
      return ''
  }
}

function turnPreview(turn: Turn, fallback: string): string {
  const text = turn.user?.text.trim() ?? ''
  if (!text) return fallback
  const oneLine = text.replace(/\s+/g, ' ')
  return oneLine.length > 48 ? `${oneLine.slice(0, 47).trimEnd()}...` : oneLine
}

function processBlockHasError(block: ChatBlock): boolean {
  return (
    (block.kind === 'tool' && block.status === 'error') ||
    (block.kind === 'compaction' && block.status === 'error') ||
    (block.kind === 'review' && block.status === 'error') ||
    (block.kind === 'approval' && block.status === 'error') ||
    (block.kind === 'user_input' && block.status === 'error') ||
    (block.kind === 'system' && block.severity === 'error')
  )
}

export function MessageTimeline({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  focusModeEnabled = false,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const {
    route,
    workspaceRoot,
    chooseWorkspace,
    activeClawChannel,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThreadGoal,
    activeThread
  } = useTimelineStores(activeThreadId)

  const heroRoute: 'chat' | 'claw' = route === 'claw' ? 'claw' : 'chat'
  const hasContent = blocks.length > 0 || live || liveReasoning
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const turnRefMap = useRef(new Map<string, HTMLDivElement>())

  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const latestBlock = blocks[blocks.length - 1]
  const scrollContentKey = [
    activeThreadId ?? '',
    turns.length,
    blocks.length,
    blockScrollStamp(latestBlock),
    live.length,
    liveReasoning.length
  ].join(':')
  const {
    visibleTurnCount,
    hiddenTurnCount,
    loadEarlierTurns,
    collapseEarlierTurns
  } = useTimelineScroll({
    containerRef,
    endRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    totalTurns: turns.length,
    busy,
    scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: currentTurnUserId ?? ''
    }
  })
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  const visibleTurnAnchors = useMemo(
    () => {
      const anchors: { key: string; label: string; title: string }[] = []
      let questionIndex = turns
        .slice(0, hiddenTurnCount)
        .filter((turn) => turn.user)
        .length

      visibleTurns.forEach((turn, index) => {
        if (!turn.user) return
        questionIndex += 1
        const absoluteTurnIndex = hiddenTurnCount + index
        const key = stableTurnKey(turn, absoluteTurnIndex)
        anchors.push({
          key,
          label: String(questionIndex),
          title: turnPreview(turn, t('timelineJumpTurn', { index: questionIndex }))
        })
      })
      return anchors
    },
    [hiddenTurnCount, t, turns, visibleTurns]
  )
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined

  // Tick a clock while a turn is running so the live "Worked for Xs" updates.
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy || !currentTurnUserId) return
    setTickNow(Date.now())
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, currentTurnUserId])

  const jumpToTurn = (key: string): void => {
    const target = turnRefMap.current.get(key)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div ref={containerRef} className="ds-no-drag relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {visibleTurnAnchors.length > 2 ? (
        <nav
          aria-label={t('timelineJumpRailLabel')}
          className="timeline-jump-rail"
        >
          {visibleTurnAnchors.map((anchor) => (
            <button
              key={anchor.key}
              type="button"
              className="timeline-jump-rail-button"
              title={anchor.title}
              aria-label={anchor.title}
              onClick={() => jumpToTurn(anchor.key)}
            >
              {anchor.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className={`ds-message-timeline-content ds-chat-column-inset mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 pt-8 ${
        goalTimelinePaddingClass(heroRoute, Boolean(activeThreadGoal))
      }`}>
        {!hasContent || !activeThreadId ? (
          <MessageTimelineEmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            runtimeError={runtimeError}
            activeClawChannel={activeClawChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
            focusModeEnabled={focusModeEnabled}
          />
        ) : null}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount > 0 ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', { count: Math.min(hiddenTurnCount, TURN_PAGE_SIZE) })}
            </button>
          </div>
        ) : null}

        {visibleTurns.map((turn, index) => {
          const absoluteTurnIndex = hiddenTurnCount + index
          const userId = turn.user?.id
          const isLive = !!(userId && currentTurnUserId === userId)
          const startedAt = userId ? turnStartedAtByUserId[userId] : undefined
          const recordedDuration = userId ? turnDurationByUserId[userId] : undefined
          const durationMs =
            recordedDuration ??
            (isLive && typeof startedAt === 'number'
              ? Math.max(0, tickNow - startedAt)
              : undefined)
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
          const reasoningLast = userId ? turnReasoningLastAtByUserId[userId] : undefined
          const reasoningDurationMs =
            typeof reasoningFirst === 'number' && typeof reasoningLast === 'number'
              ? Math.max(0, reasoningLast - reasoningFirst)
              : undefined
          const turnPending = threadHasPendingRuntimeWork(turn.blocks)
          const isLatestTurn = index === visibleTurns.length - 1
          const hasLiveStream = isLatestTurn && !!(liveReasoning.trim() || live.trim())
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          const turnKey = stableTurnKey(turn, absoluteTurnIndex)
          return (
            <div
              key={turnKey}
              ref={(node) => {
                if (node) {
                  turnRefMap.current.set(turnKey, node)
                } else {
                  turnRefMap.current.delete(turnKey)
                }
              }}
              className="scroll-mt-6"
            >
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <MemoMessageTurn
                turn={turn}
                isProcessing={(busy && isLatestTurn) || turnPending || hasLiveStream}
                liveReasoning={isLatestTurn ? liveReasoning : ''}
                live={isLatestTurn ? live : ''}
                durationMs={durationMs}
                reasoningDurationMs={reasoningDurationMs}
                devPreviewCard={isLatestTurn ? devPreviewCard : null}
                planActionsBusy={planActionsBusy}
                onBuildPlan={onBuildPlan}
                onOpenPlan={onOpenPlan}
                viewportRef={containerRef}
              />
            </div>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && turns.length > TURN_PAGE_SIZE && turns.length > AUTO_COLLAPSE_THRESHOLD && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                collapseEarlierTurns()
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineCollapseEarlierTurns')}
            </button>
          </div>
        ) : null}

        {blocks.length === 0 && (live || liveReasoning) ? (
          <MemoMessageTurn
            turn={{ blocks: [] }}
            isProcessing={busy}
            liveReasoning={liveReasoning}
            live={live}
            devPreviewCard={devPreviewCard}
            viewportRef={containerRef}
            durationMs={
              currentTurnUserId && typeof turnStartedAtByUserId[currentTurnUserId] === 'number'
                ? Math.max(0, tickNow - turnStartedAtByUserId[currentTurnUserId])
                : undefined
            }
            reasoningDurationMs={(() => {
              if (!currentTurnUserId) return undefined
              const first = turnReasoningFirstAtByUserId[currentTurnUserId]
              const last = turnReasoningLastAtByUserId[currentTurnUserId]
              if (typeof first !== 'number' || typeof last !== 'number') return undefined
              return Math.max(0, last - first)
            })()}
          />
        ) : null}
        <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
      </div>
    </div>
  )
}

function MessageTurn({
  turn,
  isProcessing,
  liveReasoning,
  live,
  durationMs,
  reasoningDurationMs,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  viewportRef
}: {
  turn: Turn
  isProcessing: boolean
  liveReasoning: string
  live: string
  durationMs?: number
  reasoningDurationMs?: number
  devPreviewCard?: ReactElement | null
  planActionsBusy?: boolean
  onBuildPlan?: () => void
  onOpenPlan?: () => void
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadGoal = useChatStore((s) => s.activeThreadGoal)
  // Inline Review Plan card: surfaced under a turn that produced a
  // successful `create_plan` result so the user can open/build the plan
  // without leaving the conversation.
  const planResult = useMemo(() => {
    if (isProcessing) return null
    for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
      const block = turn.blocks[index]
      if (block.kind !== 'tool' || block.status !== 'success') continue
      const meta = extractPlanMetadataFromBlock(block)
      if (meta) return meta
    }
    return null
  }, [turn.blocks, isProcessing])
  const { think: liveThink, content: liveContent } = splitThink(live)
  const liveProcessText = [liveReasoning, liveThink].filter(Boolean).join('\n\n')
  const [workExpandedOverride, setWorkExpandedOverride] = useState<boolean | null>(null)

  const { processBlocks, assistantContentBlocks, generatedFileBlocks, turnFileChanges } = useMemo(
    () =>
      deriveTurnSections({
        turn,
        isProcessing,
        liveProcessText,
        liveContent,
        workspaceRoot
      }),
    [turn, isProcessing, liveProcessText, liveContent, workspaceRoot]
  )
  const hasProcessError = processBlocks.some(processBlockHasError)
  const workExpanded = hasProcessError || (workExpandedOverride ?? isProcessing)
  const reviewBlocks = useMemo(
    () => turn.blocks.filter((block) => block.kind === 'review'),
    [turn.blocks]
  )

  const processSections = useMemo(
    () => (workExpanded ? groupProcessSections(processBlocks) : []),
    [processBlocks, workExpanded]
  )
  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
  const showLiveAssistant = !isProcessing && !!liveContent.trim()

  // Keep completed reasoning/tool work tucked away, but make the active turn's
  // work visible unless the user explicitly collapses it.

  const hasProcess = isProcessing || processBlocks.length > 0

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} /> : null}

      {hasProcess ? (
        <div className="flex flex-col gap-1 pb-2">
          <WorkMetaRow
            processing={isProcessing}
            stepCount={processBlocks.length}
            durationMs={durationMs}
            reasoningDurationMs={reasoningDurationMs}
            expanded={workExpanded}
            collapsible={!hasProcessError}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
          {workExpanded && processSections.length > 0 ? (
            <div className="flex flex-col gap-1">
              {processSections.map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  viewportRef={viewportRef}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {assistantContentBlocks.map((block) => (
        <MessageBubble key={block.id} block={block} />
      ))}

      {showLiveAssistant ? (
        <MessageBubble block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }} />
      ) : null}

      <GeneratedFilesPanel blocks={generatedFileBlocks} />

      {reviewBlocks.map((review) => (
        <ReviewSummaryCard key={review.id} review={review} />
      ))}

      {isProcessing ? <LiveTurnProgressRow hasActiveGoal={Boolean(activeThreadGoal)} /> : null}

      {!isProcessing && devPreviewCard ? devPreviewCard : null}

      {planResult ? (
        <ReviewPlanCard
          title={planResult.title?.trim() || planDisplayNameFromRelativePath(planResult.relativePath)}
          relativePath={planResult.relativePath}
          busy={planActionsBusy === true}
          onOpen={onOpenPlan}
          onBuild={onBuildPlan}
        />
      ) : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary changes={turnFileChanges} viewportRef={viewportRef} />
      ) : null}
    </div>
  )
}

function LiveTurnProgressRow({ hasActiveGoal }: { hasActiveGoal: boolean }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const swimMode = useWorkLogoSwimMode(true)
  const ikunVariant = useIkunWorkLogoVariant(true)
  // iKun 模式是全局 html 属性;进行行每个回合重新挂载,挂载时读取即可
  const [ikunModeOn] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-ikun-mode') === 'on'
  )
  const swimLabelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
  // UI 插件可声明自己的进行中文案(按泳姿键、按语言),未声明则用默认文案
  const pluginLabel = useUiPluginWorkLabel(
    swimLabelKey as UiPluginLabelKey,
    i18n.language ?? 'zh'
  )
  const label = ikunModeOn
    ? t(IKUN_WORK_LOGO_VARIANT_LABEL_KEYS[ikunVariant])
    : pluginLabel ?? t(swimLabelKey)

  return (
    <div className={liveTurnProgressClass(hasActiveGoal)}>
      <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
        <AnimatedWorkLogo active ikunVariant={ikunVariant} mode={swimMode} phase="trail" size="sm" />
      </span>
      <span className="ds-shiny-text">{label}</span>
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.isProcessing === next.isProcessing &&
  prev.liveReasoning === next.liveReasoning &&
  prev.live === next.live &&
  prev.durationMs === next.durationMs &&
  prev.reasoningDurationMs === next.reasoningDurationMs &&
  prev.devPreviewCard === next.devPreviewCard &&
  prev.planActionsBusy === next.planActionsBusy &&
  prev.onBuildPlan === next.onBuildPlan &&
  prev.onOpenPlan === next.onOpenPlan &&
  prev.viewportRef === next.viewportRef
))
