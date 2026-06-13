import type {
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  RuntimeStatusEventPayload,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload,
  UserInputQuestion
} from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import { isClawWorkspacePath, isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import { isClawThread } from './chat-store-helpers'
import {
  collectAssistantTextForTurn,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  isWriteThreadId,
  type WriteThreadRegistry
} from '../write/write-thread-registry'
import { isSddAssistantThread } from '../sdd/sdd-thread-registry'
import { notifySddChatTranscriptMirror } from '../sdd/sdd-chat-transcript'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  armBusyWatchdog as armBusyWatchdogImpl,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  syncTurnCompletionPoll as syncTurnCompletionPollImpl
} from './chat-store-schedulers'

const BUSY_WATCHDOG_MS = 180_000
const MAX_BUSY_RECOVERY_ATTEMPTS = 3
const MAX_RUNTIME_EVENT_TIMER_AGE_MS = 30 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 5_000
const RUNTIME_STREAM_RECOVERING_KEY = 'common:runtimeStreamRecovering'
const LEGACY_RUNTIME_STREAM_RECOVERING_VALUE = 'runtimeStreamRecovering'
const COMPLETION_NOTIFICATION_DEDUPE_LIMIT = 200
export const MAX_WATCHED_COMPLETION_NOTIFICATIONS = 200
export const MAX_PENDING_CLAW_FEISHU_MIRRORS = 50
const completionNotificationKeys: string[] = []
const completionNotificationKeySet = new Set<string>()
const watchCompletionNotificationKeys = new Map<string, string>()

export type PendingClawFeishuMirror = {
  threadId: string
  userBlockId: string
  userText: string
}

const pendingClawFeishuMirrors = new Map<string, PendingClawFeishuMirror>()

export function watchTurnCompletionNotification(threadId: string, now = Date.now()): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
  watchCompletionNotificationKeys.set(normalizedThreadId, `watch:${normalizedThreadId}:${now}`)
  while (watchCompletionNotificationKeys.size > MAX_WATCHED_COMPLETION_NOTIFICATIONS) {
    const oldestThreadId = watchCompletionNotificationKeys.keys().next().value
    if (!oldestThreadId) break
    watchCompletionNotificationKeys.delete(oldestThreadId)
  }
}

export function completionNotificationDedupeKeyForWatchedThread(
  threadId: string | null | undefined,
  now = Date.now()
): string {
  const normalizedThreadId = threadId?.trim()
  if (!normalizedThreadId) return `watch:unknown:${now}`
  return watchCompletionNotificationKeys.get(normalizedThreadId) ?? `watch:${normalizedThreadId}:${now}`
}

export function clearWatchedCompletionNotifications(): void {
  watchCompletionNotificationKeys.clear()
}

export function rememberPendingClawFeishuMirror(
  turnId: string,
  mirror: PendingClawFeishuMirror
): void {
  const normalizedTurnId = turnId.trim()
  const normalizedMirror = {
    threadId: mirror.threadId.trim(),
    userBlockId: mirror.userBlockId.trim(),
    userText: mirror.userText.trim()
  }
  if (
    !normalizedTurnId ||
    !normalizedMirror.threadId ||
    !normalizedMirror.userBlockId ||
    !normalizedMirror.userText
  ) {
    return
  }
  pendingClawFeishuMirrors.delete(normalizedTurnId)
  pendingClawFeishuMirrors.set(normalizedTurnId, normalizedMirror)
  while (pendingClawFeishuMirrors.size > MAX_PENDING_CLAW_FEISHU_MIRRORS) {
    const oldestTurnId = pendingClawFeishuMirrors.keys().next().value
    if (!oldestTurnId) break
    pendingClawFeishuMirrors.delete(oldestTurnId)
  }
}

export function takePendingClawFeishuMirror(
  turnId: string | null | undefined
): PendingClawFeishuMirror | undefined {
  const normalizedTurnId = turnId?.trim()
  if (!normalizedTurnId) return undefined
  const mirror = pendingClawFeishuMirrors.get(normalizedTurnId)
  pendingClawFeishuMirrors.delete(normalizedTurnId)
  return mirror
}

export function clearPendingClawFeishuMirrors(): void {
  pendingClawFeishuMirrors.clear()
}

export function buildFollowupMessageFromUserInput(
  questions: UserInputQuestion[],
  answers: Array<{ id: string; label: string; value?: string }>
): string {
  const isZh = i18n.language.toLowerCase().startsWith('zh')
  const title = isZh
    ? '上一个回合请求了 request_user_input，但当前运行时无法通过 HTTP 直接提交该工具结果。请把下面的用户回答当作 request_user_input 的结果继续执行：'
    : 'The previous turn requested request_user_input, but this runtime cannot submit that tool result over HTTP. Please treat the answers below as the request_user_input result and continue:'
  const unansweredLabel = isZh ? '（未回答）' : '(not answered)'
  const answerPrefix = isZh ? '回答: ' : 'Answer: '
  const noAnswerLabel = isZh ? '用户未提供问题回答。' : 'User did not provide answers.'
  if (questions.length === 0 || answers.length === 0) {
    return noAnswerLabel
  }
  const answerById = new Map<string, string>(answers.map((answer) => [answer.id, answer.value || answer.label]))
  const lines = [title]
  for (const question of questions) {
    const answerValue = answerById.get(question.id)
    const responseLine = answerValue ? `${answerPrefix}${answerValue}` : unansweredLabel
    lines.push(`${question.header}: ${question.question}`, responseLine)
  }
  return lines.join('\n')
}

function isUserInputInterruptError(message: string | undefined): boolean {
  const lowered = message?.toLowerCase() ?? ''
  return lowered.includes('cancel') && lowered.includes('awaiting user input')
}

function isInterruptSettledError(error: unknown, message: string): boolean {
  const code = getRuntimeErrorCode(error)
  if (code === 'aborted') return true
  if (isUserInputInterruptError(message)) return true
  const lowered = message.toLowerCase()
  return lowered.includes('interrupted') ||
    lowered.includes('aborted') ||
    lowered.includes('cancelled') ||
    lowered.includes('canceled')
}

export async function readActiveWriteWorkspace(fallbackWorkspaceRoot: string): Promise<string> {
  try {
    const settings = await rendererRuntimeClient.getSettings()
    return normalizeWorkspaceRoot(
      settings.write.activeWorkspaceRoot ||
      settings.write.defaultWorkspaceRoot ||
      settings.write.workspaces[0] ||
      fallbackWorkspaceRoot
    )
  } catch {
    return normalizeWorkspaceRoot(fallbackWorkspaceRoot)
  }
}

export async function readWriteWorkspaceRoots(): Promise<string[]> {
  try {
    const settings = await rendererRuntimeClient.getSettings()
    const roots = [
      settings.write.defaultWorkspaceRoot,
      settings.write.activeWorkspaceRoot,
      ...settings.write.workspaces
    ]
      .map((workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot))
      .filter(Boolean)
    return [...new Set(roots)]
  } catch {
    return []
  }
}

export function runtimeErrorDetail(error: unknown): string {
  const view = describeRuntimeError(error)
  if (view.detail) return view.detail
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw === view.summary ? '' : raw
}

export function runtimeStreamRecoveringMessage(): string {
  return i18n.t(RUNTIME_STREAM_RECOVERING_KEY)
}

function isRuntimeStreamRecoveringError(error: string | null | undefined): boolean {
  return (
    error === runtimeStreamRecoveringMessage() ||
    error === LEGACY_RUNTIME_STREAM_RECOVERING_VALUE ||
    error === RUNTIME_STREAM_RECOVERING_KEY
  )
}

function clearRuntimeStreamRecoveringError(error: string | null): string | null {
  return isRuntimeStreamRecoveringError(error) ? null : error
}

function runtimeEventStartedAt(createdAt: string | undefined, now = Date.now()): number {
  if (!createdAt) return now
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return now
  if (parsed > now + CLOCK_SKEW_TOLERANCE_MS) return now
  if (now - parsed > MAX_RUNTIME_EVENT_TIMER_AGE_MS) return now
  return parsed
}

export function forkedMessageCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user' || block.kind === 'assistant').length
}

export function forkedTurnCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user').length
}

function rememberCompletionNotificationKey(key: string): boolean {
  if (!key) return true
  if (completionNotificationKeySet.has(key)) return false
  completionNotificationKeySet.add(key)
  completionNotificationKeys.push(key)
  while (completionNotificationKeys.length > COMPLETION_NOTIFICATION_DEDUPE_LIMIT) {
    const stale = completionNotificationKeys.shift()
    if (stale) completionNotificationKeySet.delete(stale)
  }
  return true
}

export function clearWatchedCompletionNotification(threadId: string): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
}

function notifyTurnComplete(threadId: string | null, state: ChatState, dedupeKey: string): void {
  if (!threadId || typeof window.kunGui?.showTurnCompleteNotification !== 'function') return
  if (!rememberCompletionNotificationKey(dedupeKey)) return

  const threadTitle =
    state.threads.find((thread) => thread.id === threadId)?.title?.trim() ||
    i18n.t('common:untitledThread')

  void window.kunGui
    .showTurnCompleteNotification({
      threadId,
      title: i18n.t('common:turnCompleteNotificationTitle'),
      body: i18n.t('common:turnCompleteNotificationBody', { title: threadTitle })
    })
    .then((result) => {
      if (result.ok || typeof window.kunGui?.logError !== 'function') return
      void window.kunGui.logError('notification', 'Turn completion notification failed', {
        message: result.message,
        threadId
      }).catch(() => undefined)
    })
    .catch((error: unknown) => {
      if (typeof window.kunGui?.logError !== 'function') return
      void window.kunGui.logError('notification', 'Turn completion notification failed', {
        message: error instanceof Error ? error.message : String(error),
        threadId
      }).catch(() => undefined)
    })
}

/**
 * Compute the patch that finalizes timing for the current in-progress turn.
 * No-op if there is no current turn or its start time was not recorded.
 */
export function finalizeTurnTiming(state: ChatState): Partial<ChatState> {
  const userId = state.currentTurnUserId
  if (!userId) return {}
  const startedAt = state.turnStartedAtByUserId[userId]
  if (typeof startedAt !== 'number') {
    return { currentTurnUserId: null }
  }
  return {
    currentTurnUserId: null,
    turnDurationByUserId: {
      ...state.turnDurationByUserId,
      [userId]: Math.max(0, Date.now() - startedAt)
    }
  }
}

export function flushLiveBlocks(state: ChatState, base: Partial<ChatState> = {}): Partial<ChatState> {
  const nextBlocks = [...state.blocks]
  const now = Date.now()
  const createdAt = new Date(now).toISOString()
  if (state.liveReasoning.trim()) {
    nextBlocks.push({ kind: 'reasoning', id: `r-${now}`, createdAt, text: state.liveReasoning })
  }
  if (state.liveAssistant.trim()) {
    nextBlocks.push({ kind: 'assistant', id: `a-${now}`, createdAt, text: state.liveAssistant })
  }
  if (nextBlocks.length === state.blocks.length) return base
  return {
    ...base,
    blocks: nextBlocks,
    liveReasoning: '',
    liveAssistant: ''
  }
}

function goalStatusText(status: string): string {
  switch (status) {
    case 'active':
      return i18n.t('common:goalStatusActive')
    case 'paused':
      return i18n.t('common:goalStatusPaused')
    case 'blocked':
      return i18n.t('common:goalStatusBlocked')
    case 'usageLimited':
      return i18n.t('common:goalStatusUsageLimited')
    case 'budgetLimited':
      return i18n.t('common:goalStatusBudgetLimited')
    case 'complete':
      return i18n.t('common:goalStatusComplete')
    default:
      return status
  }
}

function goalTimelineText(goal: NonNullable<ChatState['activeThreadGoal']> | null, cleared?: boolean): string {
  if (!goal || cleared) return i18n.t('common:goalClearedTimeline')
  return i18n.t('common:goalUpdatedTimeline', {
    status: goalStatusText(goal.status),
    objective: goal.objective
  })
}

export function shouldOpenSettingsForError(error: unknown): boolean {
  return describeRuntimeError(error).settingsAction === 'agents'
}

export function looksLikeActiveTurnError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw.toLowerCase().includes('active turn')
}

export function isCodeThread(
  thread: NormalizedThread,
  clawChannels: ClawImChannelV1[] = [],
  writeRegistry?: WriteThreadRegistry
): boolean {
  const workspace = normalizeWorkspaceRoot(thread.workspace)
  return Boolean(workspace) &&
    thread.archived !== true &&
    !isInternalTemporaryWorkspace(thread.workspace) &&
    !isClawWorkspacePath(thread.workspace) &&
    !isClawThread(thread, clawChannels) &&
    !isWriteThreadId(thread.id, writeRegistry) &&
    !isSddAssistantThread(thread)
}

export function latestThread(threads: NormalizedThread[]): NormalizedThread | null {
  return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
}

function normalizeFilePathForMatch(path?: string | null): string {
  return path?.trim().replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function resolveWriteToolFilePath(filePath: string | undefined, workspaceRoot: string): string {
  const raw = normalizeFilePathForMatch(filePath)
  if (!raw) return ''
  if (isAbsoluteFilePath(raw)) return raw
  return `${normalizeFilePathForMatch(workspaceRoot)}/${raw.replace(/^\.?\//, '')}`
}

function notifyWriteWorkspaceFileRefresh(
  get: () => ChatState,
  event?: Pick<ToolEventPayload, 'filePath' | 'status' | 'toolKind'>
): void {
  if (get().route !== 'write') return
  if (event && (event.toolKind !== 'file_change' || event.status !== 'success')) return

  const writeState = useWriteWorkspaceStore.getState()
  const workspaceRoot = normalizeFilePathForMatch(writeState.workspaceRoot)
  const activeFilePath = normalizeFilePathForMatch(writeState.activeFilePath)
  if (!workspaceRoot || !activeFilePath) return

  const candidatePath = resolveWriteToolFilePath(event?.filePath, workspaceRoot)
  const hasCandidate = candidatePath.length > 0
  const candidateInWorkspace = hasCandidate
    ? candidatePath === workspaceRoot || candidatePath.startsWith(`${workspaceRoot}/`)
    : true
  if (!candidateInWorkspace) return

  void useWriteWorkspaceStore.getState().refreshWorkspace(workspaceRoot)

  if (hasCandidate && candidatePath !== activeFilePath) return
  void useWriteWorkspaceStore.getState().syncActiveFileFromDisk(workspaceRoot, {
    path: activeFilePath,
    animate: true,
    force: true
  })
}

function runtimeStatusText(event: RuntimeStatusEventPayload): string {
  if (event.kind === 'tool_result_upload_wait') {
    return i18n.t('common:toolUploadWaitStatus', { count: event.toolResultCount ?? 0 })
  }
  if (event.kind === 'image_recognition_progress') {
    if (event.progressStatus === 'failed') {
      return i18n.t('common:imageRecognitionProgressFailed', {
        current: event.progressCurrent ?? 0,
        total: event.progressTotal ?? 0
      })
    }
    if (event.progressStatus === 'completed') {
      return i18n.t('common:imageRecognitionProgressCompleted', {
        current: event.progressCurrent ?? 0,
        total: event.progressTotal ?? 0
      })
    }
    return i18n.t('common:imageRecognitionProgressRunning', {
      current: event.progressCurrent ?? 0,
      total: event.progressTotal ?? 0
    })
  }
	  if (event.kind === 'tool_catalog_changed') {
	    return event.message?.trim() || i18n.t('common:toolCatalogChangedStatus')
	  }
	  if (event.kind === 'tool_storm_suppressed') {
	    return event.message?.trim() || i18n.t('common:toolStormSuppressedStatus', {
	      tool: event.toolName ?? 'tool'
	    })
	  }
  if (event.kind === 'compaction_summary_fallback') {
    return event.message?.trim() || i18n.t('common:compactionSummaryFallbackStatus')
  }
	  return event.message?.trim() || ''
	}

function runtimeErrorPayloadToError(event: {
  message: string
  code?: string
  details?: unknown
  severity?: string
}): Error {
  return new Error(JSON.stringify({
    ...(event.code ? { code: event.code } : {}),
    message: event.message,
    ...(event.details !== undefined ? { details: event.details } : {}),
    ...(event.severity ? { severity: event.severity } : {})
  }))
}

function normalizeRuntimeErrorText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function sameRuntimeErrorContent(
  left: Extract<ChatBlock, { kind: 'system' }>,
  right: Extract<ChatBlock, { kind: 'system' }>
): boolean {
  return (
    left.severity === right.severity &&
    left.code === right.code &&
    normalizeRuntimeErrorText(left.text) === normalizeRuntimeErrorText(right.text) &&
    normalizeRuntimeErrorText(left.detail) === normalizeRuntimeErrorText(right.detail)
  )
}

function findSameTurnRuntimeErrorIndex(
  blocks: ChatBlock[],
  block: Extract<ChatBlock, { kind: 'system' }>
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const candidate = blocks[index]
    if (candidate.kind === 'user') break
    if (candidate.kind === 'system' && sameRuntimeErrorContent(candidate, block)) return index
  }
  return -1
}

function upsertRuntimeErrorBlock(blocks: ChatBlock[], block: Extract<ChatBlock, { kind: 'system' }>): ChatBlock[] {
  const index = blocks.findIndex((candidate) => candidate.kind === 'system' && candidate.id === block.id)
  if (index < 0) {
    const duplicateIndex = findSameTurnRuntimeErrorIndex(blocks, block)
    if (duplicateIndex < 0) return [...blocks, block]
    const next = [...blocks]
    const existing = next[duplicateIndex]
    next[duplicateIndex] = {
      ...block,
      createdAt: existing?.createdAt ?? block.createdAt
    }
    return next
  }
  const next = [...blocks]
  next[index] = block
  return next
}

export function armBusyWatchdog(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  armBusyWatchdogImpl(set, get, {
    timeoutMs: BUSY_WATCHDOG_MS,
    maxAttempts: MAX_BUSY_RECOVERY_ATTEMPTS,
    finalizeBusyState: finalizeTurnTiming,
    // Settle stuck running/pending blocks alongside the live flush: a
    // timed-out turn that leaves a tool block "running" keeps
    // hasPendingRuntimeWork true, which queues every later message
    // forever ("queued, sends after current reply") with nothing to
    // drain it.
    flushLiveBlocks: (state, base) => {
      const flushed = flushLiveBlocks(state, base)
      const blocks = settlePendingRuntimeWorkAfterInterrupt(flushed.blocks ?? state.blocks)
      return { ...flushed, blocks }
    },
    busyTimeoutMessage: () => i18n.t('common:busyTimeout', { minutes: Math.round((BUSY_WATCHDOG_MS * MAX_BUSY_RECOVERY_ATTEMPTS) / 60_000) })
  })
}

export function syncTurnCompletionPoll(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  syncTurnCompletionPollImpl(set, get, {
    loadThreadState: async (state, threadId) => {
      const provider = getProvider()
      return provider.getThreadDetail(threadId)
    },
    threadLooksRunning: threadSnapshotLooksRunning,
    onCompletedThreads: async (doneIds, state, setState, getState) => {
      for (const id of doneIds) {
        notifyTurnComplete(
          id,
          state,
          completionNotificationDedupeKeyForWatchedThread(id)
        )
        clearWatchedCompletionNotification(id)
      }
      setState((snapshot) => {
        const watchTurnCompletion = { ...snapshot.watchTurnCompletion }
        const unreadThreadIds = { ...snapshot.unreadThreadIds }
        for (const id of doneIds) {
          delete watchTurnCompletion[id]
          unreadThreadIds[id] = true
        }
        return { watchTurnCompletion, unreadThreadIds }
      })
      void getState().refreshThreads()
    }
  })
}

export type ThreadEventSinkBinding = {
  threadId?: string
  signal?: AbortSignal
  /**
   * Seq the subscription replays from. Deltas at or below this floor are
   * duplicates of text already in the timeline (a replayed backlog or a
   * re-delivered live event) and are dropped instead of appended, so a
   * stale cursor can no longer re-stream the whole conversation into the
   * live bubble.
   */
  sinceSeq?: number
}

export function buildThreadEventSink(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  binding: ThreadEventSinkBinding = {}
): ThreadEventSink {
  const boundThreadId = binding.threadId?.trim() ?? ''
  let appliedDeltaSeqFloor = binding.sinceSeq ?? 0
  const isCurrentStream = (): boolean => {
    if (binding.signal?.aborted) return false
    return !boundThreadId || get().activeThreadId === boundThreadId
  }

  return {
    onSeq: (seq) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      // Monotonic: heartbeats and replays must never rewind the cursor —
      // a rewound lastSeq becomes the next subscription's since_seq and
      // replays history.
      set((s) => ({
        lastSeq: Math.max(s.lastSeq, seq),
        error: clearRuntimeStreamRecoveringError(s.error)
      }))
    },
    onUserMessage: (ev) =>
      set((s) => {
        if (!isCurrentStream()) return {}
        resetBusyRecoveryAttempts()
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const optimisticCurrentUserId = s.currentTurnUserId
        const reconciledBlocks =
          optimisticCurrentUserId &&
          optimisticCurrentUserId !== ev.itemId &&
          baseBlocks.some((block) => block.kind === 'user' && block.id === optimisticCurrentUserId)
            ? reconcileOptimisticUserBlock(
                baseBlocks,
                optimisticCurrentUserId,
                ev.itemId,
                ev.text,
                ev.modelLabel
              )
            : baseBlocks
        const nextBlocks = upsertUserBlock(reconciledBlocks, ev)
        const startedAt = runtimeEventStartedAt(ev.createdAt)
        armBusyWatchdog(set, get)
        return {
          ...flushed,
          blocks: nextBlocks,
          busy: true,
          currentTurnId: ev.turnId ?? s.currentTurnId,
          currentTurnUserId: ev.itemId,
          turnStartedAtByUserId: {
            ...s.turnStartedAtByUserId,
            [ev.itemId]: s.turnStartedAtByUserId[ev.itemId] ?? startedAt
          },
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      }),
    onDeltas: (rawDeltas) => {
      if (!isCurrentStream()) return
      const deltas: typeof rawDeltas = []
      for (const delta of rawDeltas) {
        if (typeof delta.seq === 'number') {
          if (delta.seq <= appliedDeltaSeqFloor) continue
          appliedDeltaSeqFloor = delta.seq
        }
        deltas.push(delta)
      }
      if (deltas.length === 0) return
      set((s) => {
        resetBusyRecoveryAttempts()
        const nextError = clearRuntimeStreamRecoveringError(s.error)
        const seqs = deltas
          .map((delta) => delta.seq)
          .filter((value): value is number => typeof value === 'number')
        const nextLastSeq = seqs.length > 0 ? Math.max(s.lastSeq, ...seqs) : s.lastSeq
        const base: Partial<ChatState> = {
          error: nextError,
          ...(nextLastSeq !== s.lastSeq ? { lastSeq: nextLastSeq } : {})
        }
        // When deltas arrive but busy is false (e.g. switching back to a running
        // thread or SSE stream recovered from a transient error), restore the
        // busy flag so the interrupt button reappears.
        if (!s.busy) {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        let liveReasoning = s.liveReasoning
        let liveAssistant = s.liveAssistant
        let nextReasoningFirstAtByUserId = s.turnReasoningFirstAtByUserId
        let nextReasoningLastAtByUserId = s.turnReasoningLastAtByUserId
        const userId = s.currentTurnUserId
        let sawReasoning = false
        for (const delta of deltas) {
          if (delta.kind === 'agent_reasoning') {
            liveReasoning += delta.text
            sawReasoning = true
            continue
          }
          liveAssistant += delta.text
        }
        // Stamp reasoning timings once per batch instead of per delta.
        if (sawReasoning && userId) {
          const now = Date.now()
          if (typeof nextReasoningFirstAtByUserId[userId] !== 'number') {
            nextReasoningFirstAtByUserId = { ...s.turnReasoningFirstAtByUserId, [userId]: now }
          }
          nextReasoningLastAtByUserId = { ...s.turnReasoningLastAtByUserId, [userId]: now }
        }
        return {
          ...base,
          ...(liveReasoning !== s.liveReasoning ? { liveReasoning } : {}),
          ...(liveAssistant !== s.liveAssistant ? { liveAssistant } : {}),
          ...(nextReasoningFirstAtByUserId !== s.turnReasoningFirstAtByUserId
            ? { turnReasoningFirstAtByUserId: nextReasoningFirstAtByUserId }
            : {}),
          ...(nextReasoningLastAtByUserId !== s.turnReasoningLastAtByUserId
            ? { turnReasoningLastAtByUserId: nextReasoningLastAtByUserId }
            : {})
        }
      })
    },
    onTool: (ev) => {
      if (!isCurrentStream()) return
      notifyWriteWorkspaceFileRefresh(get, ev)
      set((s) => {
        resetBusyRecoveryAttempts()
        // Restore busy state on tool events (same reasoning as onDelta).
        const base: Partial<ChatState> = {}
        if (!s.busy) {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        const idx = s.blocks.findIndex((b) => b.kind === 'tool' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'tool') return { ...base }
          const next: ToolBlock = {
            ...cur,
            summary: ev.summary || cur.summary,
            status: ev.status,
            toolKind: ev.toolKind ?? cur.toolKind,
            detail: ev.detail ?? cur.detail,
            filePath: ev.filePath ?? cur.filePath,
            meta: ev.meta ?? cur.meta
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return {
            ...base,
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        // New tool — flush pending live reasoning/assistant first so each
        // reasoning segment becomes its own timeline block in chronological
        // order, rather than collapsing into one giant trailing block.
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ToolBlock = {
          kind: 'tool',
          id: ev.itemId,
          createdAt: new Date().toISOString(),
          summary: ev.summary,
          status: ev.status,
          toolKind: ev.toolKind,
          detail: ev.detail,
          filePath: ev.filePath,
          meta: ev.meta
        }
        return {
          ...base,
          ...flushed,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onCompaction: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (!s.busy && ev.status === 'running') {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        const idx = s.blocks.findIndex((b) => b.kind === 'compaction' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'compaction') return { ...base }
          const next: CompactionBlock = {
            ...cur,
            summary: ev.summary || cur.summary,
            status: ev.status,
            detail: ev.detail ?? cur.detail,
            auto: ev.auto ?? cur.auto,
            messagesBefore: ev.messagesBefore ?? cur.messagesBefore,
            messagesAfter: ev.messagesAfter ?? cur.messagesAfter,
            createdAt: cur.createdAt ?? ev.createdAt
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return {
            ...base,
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: CompactionBlock = {
          kind: 'compaction',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          summary: ev.summary,
          status: ev.status,
          detail: ev.detail,
          auto: ev.auto,
          messagesBefore: ev.messagesBefore,
          messagesAfter: ev.messagesAfter
        }
        return {
          ...base,
          ...flushed,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onReview: (ev: ReviewEventPayload) => {
      if (!isCurrentStream()) return
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (!s.busy && ev.status === 'running') {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        const idx = s.blocks.findIndex((b) => b.kind === 'review' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'review') return { ...base }
          const next: ReviewBlock = {
            ...cur,
            title: ev.title || cur.title,
            status: ev.status,
            target: ev.target ?? cur.target,
            reviewText: ev.reviewText ?? cur.reviewText,
            output: ev.output ?? cur.output,
            createdAt: cur.createdAt ?? ev.createdAt
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return {
            ...base,
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ReviewBlock = {
          kind: 'review',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          title: ev.title,
          status: ev.status,
          target: ev.target,
          reviewText: ev.reviewText,
          output: ev.output
        }
        return {
          ...base,
          ...flushed,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onApproval: (req) =>
      set((s) => {
        if (!isCurrentStream()) return {}
        resetBusyRecoveryAttempts()
        if (s.blocks.some((b) => b.kind === 'approval' && b.approvalId === req.approvalId)) {
          return {}
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        return {
          ...flushed,
          blocks: [
            ...baseBlocks,
            {
              kind: 'approval',
              id: `approval-${req.approvalId}`,
              createdAt: new Date().toISOString(),
              approvalId: req.approvalId,
              summary: req.summary,
              toolName: req.toolName,
              status: 'pending' as const,
              ...(req.meta ? { meta: req.meta } : {})
            }
          ],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      }),
    onUserInput: (req) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      set((s) => {
        if (s.blocks.some((b) => b.kind === 'user_input' && b.requestId === req.requestId)) {
          return {}
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        return {
          ...flushed,
          blocks: [
            ...baseBlocks,
            {
              kind: 'user_input',
              id: req.itemId,
              createdAt: new Date().toISOString(),
              requestId: req.requestId,
              questions: req.questions,
              status: 'pending' as const
            }
          ],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onUserInputStatus: (ev) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (ev.status === 'submitted' && get().busy) {
        armBusyWatchdog(set, get)
      }
      set((s) => ({
        error: clearRuntimeStreamRecoveringError(s.error),
        blocks: s.blocks.map((b) =>
          b.kind === 'user_input' && b.id === ev.itemId
            ? b.status === 'submitted' && ev.status === 'error' && isUserInputInterruptError(ev.errorMessage)
              ? b
              : {
                  ...b,
                  status: ev.status,
                  answers: ev.answers ?? b.answers,
                  errorMessage: ev.errorMessage ?? b.errorMessage
                }
            : b
        )
      }))
    },
    onRuntimeStatus: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (!s.busy) {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const text = runtimeStatusText(ev)
        const block: ChatBlock = {
          kind: 'system',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          text,
          ...(ev.kind === 'image_recognition_progress'
            ? {
                progress: {
                  current: ev.progressCurrent ?? 0,
                  total: ev.progressTotal ?? 1,
                  status: ev.progressStatus ?? 'running'
                }
              }
            : {})
        }
        const idx = baseBlocks.findIndex((candidate) => candidate.kind === 'system' && candidate.id === ev.itemId)
        const blocks = [...baseBlocks]
        if (idx >= 0) blocks[idx] = block
        else blocks.push(block)
        return {
          ...base,
          ...flushed,
          blocks,
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onRuntimeError: (ev) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((s) => {
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const view = describeRuntimeError(runtimeErrorPayloadToError(ev))
        const block: Extract<ChatBlock, { kind: 'system' }> = {
          kind: 'system',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          text: view.summary,
          ...(view.code ? { code: view.code } : {}),
          ...(view.detail ? { detail: view.detail } : {}),
          severity: ev.severity ?? 'error'
        }
        return {
          ...flushed,
          blocks: upsertRuntimeErrorBlock(baseBlocks, block),
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onGoal: (ev) => {
      if (!isCurrentStream()) return
      if (!ev.threadId) return
      resetBusyRecoveryAttempts()
      set((s) => {
        const currentThread = s.activeThreadId === ev.threadId
        const updatedAt = ev.goal?.updatedAt ?? ev.createdAt ?? new Date().toISOString()
        const nextThreads = s.threads.map((thread) =>
          thread.id === ev.threadId
            ? {
                ...thread,
                goal: ev.goal,
                updatedAt
              }
            : thread
        )
        if (!currentThread) {
          return { threads: nextThreads }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ChatBlock = {
          kind: 'system',
          id: `goal-${ev.threadId}-${updatedAt}-${ev.goal?.status ?? 'cleared'}`,
          createdAt: updatedAt,
          text: goalTimelineText(ev.goal, ev.cleared)
        }
        return {
          ...flushed,
          activeThreadGoal: ev.goal,
          threads: nextThreads,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onTodos: (ev) => {
      if (!isCurrentStream()) return
      if (!ev.threadId) return
      resetBusyRecoveryAttempts()
      set((s) => {
        const currentThread = s.activeThreadId === ev.threadId
        const todos = ev.cleared ? null : ev.todos
        const updatedAt = todos?.updatedAt ?? ev.createdAt ?? new Date().toISOString()
        const nextThreads = s.threads.map((thread) =>
          thread.id === ev.threadId
            ? {
                ...thread,
                todos,
                updatedAt
              }
            : thread
        )
        return currentThread
          ? {
              activeThreadTodos: todos,
              threads: nextThreads,
              error: clearRuntimeStreamRecoveringError(s.error)
            }
          : { threads: nextThreads }
      })
    },
    onTurnComplete: () => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const completedState = get()
      const completedThreadId = completedState.activeThreadId
      const completedTurnId = completedState.currentTurnId
      const completedKey = completedState.currentTurnId
        ? `turn:${completedState.currentTurnId}`
        : `active:${completedThreadId ?? 'unknown'}:${completedState.lastSeq}`
      const pendingMirror = takePendingClawFeishuMirror(completedTurnId)
      const assistantMirrorText =
        pendingMirror
          ? collectAssistantTextForTurn(
              completedState.blocks,
              pendingMirror.userBlockId,
              completedState.liveAssistant
            )
          : ''
      set((s) => {
        const base = flushLiveBlocks(s, {
          ...finalizeTurnTiming(s),
          error: null,
          currentTurnId: null
        })
        if (s.busy) base.busy = false
        const id = s.activeThreadId
        if (id) {
          const w = { ...s.watchTurnCompletion }
          delete w[id]
          clearWatchedCompletionNotification(id)
          base.watchTurnCompletion = w
          const u = { ...s.unreadThreadIds }
          delete u[id]
          base.unreadThreadIds = u
        }
        return base
      })
      if (pendingMirror && assistantMirrorText && typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
        void window.kunGui.mirrorClawChannelMessage(
          pendingMirror.threadId,
          assistantMirrorText,
          'assistant'
        ).catch(() => undefined)
      }
      notifyTurnComplete(completedThreadId, completedState, completedKey)
      notifyWriteWorkspaceFileRefresh(get)
      notifySddChatTranscriptMirror(get)
      syncTurnCompletionPoll(set, get)
      void get().refreshThreads()
      void get().drainQueuedMessages()
    },
    onError: (err, options) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const state = get()
      const message = formatRuntimeError(err)
      const detail = runtimeErrorDetail(err)
      const terminal = options?.terminal === true
      const interrupted = isInterruptSettledError(err, message)
      takePendingClawFeishuMirror(state.currentTurnId)
      set((s) => {
        const wasBusy = s.busy
        const shouldSettleTurn = terminal || !wasBusy || interrupted
        const out = flushLiveBlocks(s, {
          ...finalizeTurnTiming(s),
          error: interrupted ? null : message,
          runtimeErrorDetail: interrupted ? null : detail || null
        })
        // Keep the busy flag if the turn was active — the interrupt button
        // should stay visible so the user can interrupt a stuck turn. The
        // watchdog (re-armed below) will eventually time out if the turn
        // never recovers.
        if (shouldSettleTurn) {
          out.busy = false
          out.currentTurnId = null
          out.currentTurnUserId = null
          out.blocks = settlePendingRuntimeWorkAfterInterrupt(out.blocks ?? s.blocks)
          if (terminal && s.activeThreadId) {
            const w = { ...s.watchTurnCompletion }
            delete w[s.activeThreadId]
            clearWatchedCompletionNotification(s.activeThreadId)
            out.watchTurnCompletion = w
            const u = { ...s.unreadThreadIds }
            delete u[s.activeThreadId]
            out.unreadThreadIds = u
          }
        }
        return out
      })
      if (terminal) {
        syncTurnCompletionPoll(set, get)
        void get().refreshThreads?.()
        void get().drainQueuedMessages?.()
        return
      }
      // Re-arm the watchdog so a stuck SSE stream doesn't leave the UI
      // permanently in the busy state.
      if (get().busy) armBusyWatchdog(set, get)
    },
    onUsage: () => {
      if (!isCurrentStream()) return
      set((s) => ({ usageRefreshKey: s.usageRefreshKey + 1 }))
    }
  }
}
