import { create } from 'zustand'
import type {
  ChatBlock,
  NormalizedThread,
  ThreadDeltaEvent,
  ThreadEventSink,
  UserInputQuestion,
  ToolEventPayload,
  ToolBlock,
  CompactionBlock
} from '../agent/types'
import { getProvider } from '../agent/registry'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { isClawWorkspacePath, isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import {
  buildClawRuntimePrompt,
  getActiveAgentRuntimeSettings,
  type ClawImChannelV1
} from '@shared/app-settings'
import type {
  AppRoute,
  ChatState,
  InitialSetupMode,
  PluginHostRoute,
  QueuedUserMessage,
  SendMessageOverrides,
  SettingsRouteSection
} from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'
import { createClawActions } from './chat-store-claw-actions'
import {
  activeClawChannel,
  hydrateBlockModelLabels,
  mergeComposerPickList,
  newClawChannel,
  normalizeClawComposerModel,
  optimisticUserModelLabel,
  persistComposerModel,
  readStoredComposerModel,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  reconcileOptimisticUserBlock,
  threadBelongsToWorkspace,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeThreadBelongsToWorkspace
} from '../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  armBusyWatchdog as armBusyWatchdogImpl,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll,
  syncTurnCompletionPoll as syncTurnCompletionPollImpl
} from './chat-store-schedulers'

export type { AppRoute, SettingsRouteSection } from './chat-store-types'
export { CLAW_COMPOSER_MODEL_IDS } from './chat-store-helpers'

let sseAbort: AbortController | null = null
const sseAbortRef = {
  get current(): AbortController | null {
    return sseAbort
  },
  set current(value: AbortController | null) {
    sseAbort = value
  }
}
let composerModelLoadPromise: Promise<void> | null = null
let bootPromise: Promise<void> | null = null
const BUSY_WATCHDOG_MS = 180_000
const MAX_BUSY_RECOVERY_ATTEMPTS = 3
const MAX_RUNTIME_EVENT_TIMER_AGE_MS = 30 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 5_000
let drainingQueuedMessages = false
let clawChannelActivityUnsubscribe: (() => void) | null = null
const pendingClawFeishuMirrors = new Map<
  string,
  { threadId: string; userBlockId: string; userText: string }
>()
const COMPLETION_NOTIFICATION_DEDUPE_LIMIT = 200
const completionNotificationKeys: string[] = []
const completionNotificationKeySet = new Set<string>()
const watchCompletionNotificationKeys = new Map<string, string>()

function buildFollowupMessageFromUserInput(
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

async function readActiveWriteWorkspace(fallbackWorkspaceRoot: string): Promise<string> {
  try {
    const settings = await window.dsGui.getSettings()
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

async function readWriteWorkspaceRoots(): Promise<string[]> {
  try {
    const settings = await window.dsGui.getSettings()
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

function runtimeErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

function runtimeEventStartedAt(createdAt: string | undefined, now = Date.now()): number {
  if (!createdAt) return now
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return now
  if (parsed > now + CLOCK_SKEW_TOLERANCE_MS) return now
  if (now - parsed > MAX_RUNTIME_EVENT_TIMER_AGE_MS) return now
  return parsed
}

function forkedMessageCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user' || block.kind === 'assistant').length
}

function forkedTurnCount(blocks: ChatBlock[]): number {
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

function clearWatchedCompletionNotification(threadId: string): void {
  watchCompletionNotificationKeys.delete(threadId)
}

function notifyTurnComplete(threadId: string | null, state: ChatState, dedupeKey: string): void {
  if (!threadId || typeof window.dsGui?.showTurnCompleteNotification !== 'function') return
  if (!rememberCompletionNotificationKey(dedupeKey)) return

  const threadTitle =
    state.threads.find((thread) => thread.id === threadId)?.title?.trim() ||
    i18n.t('common:untitledThread')

  void window.dsGui
    .showTurnCompleteNotification({
      threadId,
      title: i18n.t('common:turnCompleteNotificationTitle'),
      body: i18n.t('common:turnCompleteNotificationBody', { title: threadTitle })
    })
    .then((result) => {
      if (result.ok || typeof window.dsGui?.logError !== 'function') return
      void window.dsGui.logError('notification', 'Turn completion notification failed', {
        message: result.message,
        threadId
      })
    })
    .catch((error: unknown) => {
      if (typeof window.dsGui?.logError !== 'function') return
      void window.dsGui.logError('notification', 'Turn completion notification failed', {
        message: error instanceof Error ? error.message : String(error),
        threadId
      })
    })
}

/**
 * Compute the patch that finalizes timing for the current in-progress turn.
 * No-op if there is no current turn or its start time was not recorded.
 */
function finalizeTurnTiming(state: ChatState): Partial<ChatState> {
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

function flushLiveBlocks(state: ChatState, base: Partial<ChatState> = {}): Partial<ChatState> {
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

function shouldOpenSettingsForError(error: unknown): boolean {
  return getRuntimeErrorCode(error) === 'missing_api_key'
}

function looksLikeActiveTurnError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw.toLowerCase().includes('active turn')
}

function isCodeThread(thread: NormalizedThread): boolean {
  const workspace = normalizeWorkspaceRoot(thread.workspace)
  return Boolean(workspace) &&
    thread.archived !== true &&
    !isInternalTemporaryWorkspace(thread.workspace) &&
    !isClawWorkspacePath(thread.workspace) &&
    !isWriteThreadId(thread.id)
}

function latestThread(threads: NormalizedThread[]): NormalizedThread | null {
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

function armBusyWatchdog(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  armBusyWatchdogImpl(set, get, {
    timeoutMs: BUSY_WATCHDOG_MS,
    maxAttempts: MAX_BUSY_RECOVERY_ATTEMPTS,
    finalizeBusyState: finalizeTurnTiming,
    flushLiveBlocks,
    busyTimeoutMessage: () => i18n.t('common:busyTimeout')
  })
}

function syncTurnCompletionPoll(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  syncTurnCompletionPollImpl(set, get, {
    loadThreadState: async (state, threadId) => {
      const provider = getProvider(state.providerId)
      return provider.getThreadDetail(threadId)
    },
    threadLooksRunning: threadSnapshotLooksRunning,
    onCompletedThreads: async (doneIds, state, setState, getState) => {
      for (const id of doneIds) {
        notifyTurnComplete(
          id,
          state,
          watchCompletionNotificationKeys.get(id) ?? `watch:${id}:${Date.now()}`
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

function buildThreadEventSink(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): ThreadEventSink {
  return {
    onSeq: (seq) => {
      resetBusyRecoveryAttempts()
      set((s) => ({
        lastSeq: seq,
        error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
      }))
    },
    onUserMessage: (ev) =>
      set((s) => {
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
          error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
        }
      }),
    onDeltas: (deltas) =>
      set((s) => {
        if (deltas.length === 0) return {}
        resetBusyRecoveryAttempts()
        const nextError = s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
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
        for (const delta of deltas) {
          if (delta.kind === 'agent_reasoning') {
            liveReasoning += delta.text
            if (userId) {
              const now = Date.now()
              if (typeof nextReasoningFirstAtByUserId[userId] !== 'number') {
                nextReasoningFirstAtByUserId =
                  nextReasoningFirstAtByUserId === s.turnReasoningFirstAtByUserId
                    ? { ...s.turnReasoningFirstAtByUserId, [userId]: now }
                    : { ...nextReasoningFirstAtByUserId, [userId]: now }
              }
              nextReasoningLastAtByUserId =
                nextReasoningLastAtByUserId === s.turnReasoningLastAtByUserId
                  ? { ...s.turnReasoningLastAtByUserId, [userId]: now }
                  : { ...nextReasoningLastAtByUserId, [userId]: now }
            }
            continue
          }
          liveAssistant += delta.text
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
      }),
    onTool: (ev) => {
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
            error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
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
          error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
        }
      })
    },
    onCompaction: (ev) => {
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
            error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
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
          error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
        }
      })
    },
    onApproval: (req) =>
      set((s) => {
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
              status: 'pending' as const
            }
          ],
          error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
        }
      }),
    onUserInput: (req) => {
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
          error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error
        }
      })
    },
    onUserInputStatus: (ev) => {
      resetBusyRecoveryAttempts()
      if (ev.status === 'submitted' && get().busy) {
        armBusyWatchdog(set, get)
      }
      set((s) => ({
        error: s.error === i18n.t('common:runtimeStreamRecovering') ? null : s.error,
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
    onTurnComplete: () => {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const completedState = get()
      const completedThreadId = completedState.activeThreadId
      const completedTurnId = completedState.currentTurnId
      const completedKey = completedState.currentTurnId
        ? `turn:${completedState.currentTurnId}`
        : `active:${completedThreadId ?? 'unknown'}:${completedState.lastSeq}`
      const pendingMirror = completedTurnId ? pendingClawFeishuMirrors.get(completedTurnId) : undefined
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
      if (completedTurnId) {
        pendingClawFeishuMirrors.delete(completedTurnId)
      }
      if (pendingMirror && assistantMirrorText && typeof window.dsGui?.mirrorClawChannelMessageToFeishu === 'function') {
        void window.dsGui.mirrorClawChannelMessageToFeishu(
          pendingMirror.threadId,
          assistantMirrorText,
          'assistant'
        )
      }
      notifyTurnComplete(completedThreadId, completedState, completedKey)
      notifyWriteWorkspaceFileRefresh(get)
      syncTurnCompletionPoll(set, get)
      void get().refreshThreads()
      void get().drainQueuedMessages()
    },
    onError: (err) => {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const state = get()
      if (state.currentTurnId) {
        pendingClawFeishuMirrors.delete(state.currentTurnId)
      }
      set((s) => {
        const wasBusy = s.busy
        const out = flushLiveBlocks(s, {
          ...finalizeTurnTiming(s),
          error: formatRuntimeError(err)
        })
        // Keep the busy flag if the turn was active — the interrupt button
        // should stay visible so the user can interrupt a stuck turn. The
        // watchdog (re-armed below) will eventually time out if the turn
        // never recovers.
        if (!wasBusy) {
          out.busy = false
          out.currentTurnId = null
        }
        return out
      })
      // Re-arm the watchdog so a stuck SSE stream doesn't leave the UI
      // permanently in the busy state.
      if (get().busy) armBusyWatchdog(set, get)
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  route: 'chat',
  settingsReturnRoute: 'chat',
  pluginHostRoute: 'chat',
  settingsSection: 'general',
  initialSetupOpen: false,
  initialSetupMode: 'required',
  providerId: 'codewhale',
  workspaceRoot: '',
  workspaceLabel: i18n.t('common:workingDirectory'),
  runtimeConnection: 'idle',
  threads: [],
  threadSearch: '',
  showArchivedThreads: false,
  activeThreadId: null,
  blocks: [],
  liveReasoning: '',
  liveAssistant: '',
  lastSeq: 0,
  busy: false,
  error: null,
  runtimeErrorDetail: null,
  currentTurnId: null,
  currentTurnUserId: null,
  turnStartedAtByUserId: {},
  turnDurationByUserId: {},
  turnReasoningFirstAtByUserId: {},
  turnReasoningLastAtByUserId: {},
  inspectorSelectedId: null,
  composerModel: '',
  composerPickList: mergeComposerPickList(false, []),
  queuedMessages: [],
  watchTurnCompletion: {},
  unreadThreadIds: {},
  clawChannels: [],
  activeClawChannelId: '',

  ...createClawActions({
    set,
    get,
    i18n,
    getProvider,
    newClawChannel,
    normalizeClawComposerModel,
    activeClawChannel,
    normalizeWorkspaceRoot: (workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot ?? undefined),
    formatRuntimeError,
    shouldOpenSettingsForError,
    clearedThreadSelection,
    sseAbortRef,
    clearBusyWatchdog
  }),

  ...createAppActions({
    set,
    get,
    i18n,
    persistComposerModel,
    readStoredComposerModel,
    mergeComposerPickList,
    getComposerModelLoadPromise: () => composerModelLoadPromise,
    setComposerModelLoadPromise: (promise) => {
      composerModelLoadPromise = promise
    },
    applyTheme,
    applyUiFontScale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot: (workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot ?? undefined)
  }),

  openCode: async () => {
    const state = get()
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (activeThread && isCodeThread(activeThread)) {
      set({ route: 'chat' })
      return
    }

    const codeThreads = state.threads.filter(isCodeThread)
    const selectedWorkspace = normalizeWorkspaceRoot(state.workspaceRoot)
    const target =
      latestThread(codeThreads.filter((thread) => threadBelongsToWorkspace(thread, selectedWorkspace))) ??
      latestThread(codeThreads)

    set({ route: 'chat' })
    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id)
      return
    }

    sseAbort?.abort()
    sseAbort = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchCompletionNotificationKeys.set(state.activeThreadId, `watch:${state.activeThreadId}:${Date.now()}`)
    }
    set({
      ...clearedThreadSelection(),
      route: 'chat',
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  openWrite: async () => {
    const state = get()
    const selectedWorkspace = await readActiveWriteWorkspace(state.workspaceRoot)
    const writeWorkspaceRoots = await readWriteWorkspaceRoots()
    const registry = hydrateWriteThreadRegistry(
      state.threads,
      selectedWorkspace ? [selectedWorkspace, ...writeWorkspaceRoots] : writeWorkspaceRoots,
      pruneWriteThreadRegistry(state.threads, readWriteThreadRegistry())
    )
    saveWriteThreadRegistry(registry)
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (
      activeThread &&
      activeThread.archived !== true &&
      selectedWorkspace &&
      writeThreadBelongsToWorkspace(activeThread, selectedWorkspace, registry)
    ) {
      set({ route: 'write' })
      return
    }

    const target = activeWriteThreadForWorkspace(
      selectedWorkspace,
      state.threads.filter((thread) => thread.archived !== true),
      registry
    )

    set({ route: 'write' })
    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id)
      return
    }

    sseAbort?.abort()
    sseAbort = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchCompletionNotificationKeys.set(state.activeThreadId, `watch:${state.activeThreadId}:${Date.now()}`)
    }
    set({
      ...clearedThreadSelection(),
      route: 'write',
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  ensureWriteThreadForWorkspace: async (workspaceRoot) => {
    const state = get()
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot) || (await readActiveWriteWorkspace(state.workspaceRoot))
    if (!targetWorkspace) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return null
    }
    if (state.runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }

    const registry = hydrateWriteThreadRegistry(
      state.threads,
      [targetWorkspace],
      pruneWriteThreadRegistry(state.threads, readWriteThreadRegistry())
    )
    saveWriteThreadRegistry(registry)
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (activeThread && writeThreadBelongsToWorkspace(activeThread, targetWorkspace, registry)) {
      set({ route: 'write', error: null })
      return activeThread.id
    }

    const existing = activeWriteThreadForWorkspace(targetWorkspace, state.threads, registry)
    if (existing) {
      set({ route: 'write' })
      await get().selectThread(existing.id)
      return existing.id
    }

    return get().createWriteThread(targetWorkspace)
  },

  createWriteThread: async (workspaceRoot) => {
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot) || (await readActiveWriteWorkspace(get().workspaceRoot))
    if (!targetWorkspace) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return null
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    try {
      const p = getProvider(get().providerId)
      const thread = await p.createThread({
        workspace: targetWorkspace,
        title: WRITE_ASSISTANT_THREAD_TITLE,
        mode: 'agent'
      })
      saveWriteThreadRegistry(markWriteThread(targetWorkspace, thread.id))
      set((s) => ({
        route: 'write',
        threads: s.threads.some((item) => item.id === thread.id) ? s.threads : [thread, ...s.threads],
        error: null
      }))
      await get().refreshThreads()
      await get().selectThread(thread.id)
      return thread.id
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

  selectWriteThread: async (threadId, workspaceRoot) => {
    const targetId = threadId.trim()
    if (!targetId) return
    const thread = get().threads.find((item) => item.id === targetId)
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot) ||
      normalizeWorkspaceRoot(thread?.workspace) ||
      (await readActiveWriteWorkspace(get().workspaceRoot))
    if (targetWorkspace) {
      saveWriteThreadRegistry(markWriteThread(targetWorkspace, targetId))
    }
    set({ route: 'write' })
    await get().selectThread(targetId)
  },

  probeRuntime: async (mode = 'user') => {
    const prev = get().runtimeConnection
    if (mode === 'user') set({ runtimeConnection: 'checking' })
    try {
      if (typeof window.dsGui === 'undefined') {
        throw new Error(
          'Preload bridge missing (window.dsGui). Restart the app or check BrowserWindow preload path.'
        )
      }
      const settings = await window.dsGui.getSettings()
      const p = getProvider(settings.agentProvider)
      await p.connect()
      set({ runtimeConnection: 'ready', error: null, runtimeErrorDetail: null })
      void get().loadComposerModels()
      if (prev !== 'ready' || mode === 'user') {
        try {
          await get().refreshThreads()
        } catch {
          /* refreshThreads sets state */
        }
      }
    } catch (e) {
      const msg = formatRuntimeError(e)
      const detail = runtimeErrorDetail(e)
      const needsSettings = shouldOpenSettingsForError(e)
      if (mode === 'user') {
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      } else if (prev === 'ready') {
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    }
  },

  boot: async () => {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      try {
        if (typeof window.dsGui === 'undefined') {
          set({
            error: formatRuntimeError(
              'Preload bridge missing (window.dsGui). Restart the app or check BrowserWindow preload path.'
            ),
            runtimeConnection: 'offline',
            runtimeErrorDetail: 'Preload bridge missing (window.dsGui). Restart the app or check BrowserWindow preload path.',
            initialSetupOpen: false,
            initialSetupMode: 'required'
          })
          return
        }
        const settings = await window.dsGui.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        const needsInitialSetup = !getActiveAgentRuntimeSettings(settings).apiKey.trim()
        applyTheme(settings.theme)
        applyUiFontScale(settings.uiFontScale)
        await get().applyI18nFromSettings(settings.locale)
        if (!clawChannelActivityUnsubscribe && typeof window.dsGui.onClawChannelActivity === 'function') {
          clawChannelActivityUnsubscribe = window.dsGui.onClawChannelActivity(({ channelId, threadId }) => {
            void (async () => {
              const state = get()
              if (typeof window.dsGui === 'undefined') return
              const settings = await window.dsGui.getSettings()
              const channels = settings.claw.channels
              const activeChannelId = channels.some((channel) => channel.id === state.activeClawChannelId)
                ? state.activeClawChannelId
                : channels[0]?.id ?? ''
              set({ clawChannels: channels, activeClawChannelId: activeChannelId })
              void get().refreshThreads()
              if (state.route === 'claw' && state.activeClawChannelId === channelId) {
                if (state.activeThreadId !== threadId) {
                  await get().selectThread(threadId)
                } else {
                  await get().recoverActiveTurn()
                }
              }
            })()
          })
        }
        set({
          route: 'chat',
          initialSetupOpen: needsInitialSetup,
          initialSetupMode: 'required',
          providerId: settings.agentProvider,
          workspaceRoot,
          workspaceLabel: workspaceLabelFromPath(workspaceRoot),
          clawChannels: settings.claw.channels,
          activeClawChannelId: settings.claw.channels[0]?.id ?? '',
          runtimeConnection: needsInitialSetup ? 'idle' : get().runtimeConnection,
          error: needsInitialSetup ? null : get().error,
          runtimeErrorDetail: needsInitialSetup ? null : get().runtimeErrorDetail
        })
        if (needsInitialSetup) return
        const initialPick = get().composerPickList
        const fromStorage = readStoredComposerModel(initialPick)
        if (fromStorage) {
          set({ composerModel: fromStorage })
        }
        scheduleStartupRuntimeProbe(get)
      } catch (e) {
        set({
          error: formatRuntimeError(e),
          runtimeErrorDetail: runtimeErrorDetail(e),
          runtimeConnection: 'offline',
          initialSetupOpen: false,
          initialSetupMode: 'required',
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    })().finally(() => {
      bootPromise = null
    })
    return bootPromise
  },

  chooseWorkspace: async ({ createThreadAfter = false } = {}) => {
    try {
      const wasWriteRoute = get().route === 'write'
      if (typeof window.dsGui === 'undefined' || typeof window.dsGui.pickWorkspaceDirectory !== 'function') {
        throw new Error(i18n.t('common:workspacePickerUnavailable'))
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(get().workspaceRoot || undefined)
      if (picked.canceled || !picked.path) {
        if (createThreadAfter) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
        }
        return null
      }
      const next = await window.dsGui.setSettings({ workspaceRoot: picked.path })
      const workspaceRoot = normalizeWorkspaceRoot(next.workspaceRoot)
      set({
        workspaceRoot,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        error: null
      })
      await get().refreshThreads()
      if (workspaceRoot) {
        if (wasWriteRoute) {
          await get().openWrite()
          return workspaceRoot
        }
        const workspaceThreads = get().threads
          .filter(isCodeThread)
          .filter((thread) => threadBelongsToWorkspace(thread, workspaceRoot))
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

        if (createThreadAfter || workspaceThreads.length === 0) {
          await get().createThread({ workspaceRoot })
        } else {
          const targetThreadId = workspaceThreads[0]?.id
          if (targetThreadId && get().activeThreadId !== targetThreadId) {
            await get().selectThread(targetThreadId)
          }
        }
      }
      return workspaceRoot
    } catch (e) {
      set({
        error: formatWorkspacePickerError(e)
      })
      return null
    }
  },

  clearWorkspace: async () => {
    try {
      if (typeof window.dsGui === 'undefined' || typeof window.dsGui.setSettings !== 'function') {
        return
      }
      const next = await window.dsGui.setSettings({ workspaceRoot: '' })
      set({
        workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
        workspaceLabel: workspaceLabelFromPath(''),
        error: null
      })
      await get().refreshThreads()
    } catch {
      // silently ignore — the workspace will remain set
    }
  },

  deleteWorkspace: async (workspacePath) => {
    const normalizedPath = normalizeWorkspaceRoot(workspacePath)
    if (!normalizedPath) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { providerId, activeThreadId } = get()
    const p = getProvider(providerId)
    const workspaceThreads = get().threads.filter((thread) =>
      threadBelongsToWorkspace(thread, normalizedPath)
    )
    const deletingActive = workspaceThreads.some((th) => th.id === activeThreadId)
    if (deletingActive) {
      sseAbort?.abort()
      sseAbort = null
      clearBusyWatchdog()
    }
    try {
      for (const th of workspaceThreads) {
        await p.deleteThread(th.id)
      }
      const removeIds = new Set(workspaceThreads.map((th) => th.id))
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        const u = { ...s.unreadThreadIds }
        for (const tid of removeIds) {
          delete w[tid]
          delete u[tid]
          clearWatchedCompletionNotification(tid)
        }
        return {
          threads: s.threads.filter(
            (thread) => !threadBelongsToWorkspace(thread, normalizedPath)
          ),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(deletingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      // If the deleted workspace is the current workspaceRoot, clear it.
      if (normalizeWorkspaceRoot(get().workspaceRoot) === normalizedPath) {
        try {
          if (typeof window.dsGui?.setSettings === 'function') {
            const next = await window.dsGui.setSettings({ workspaceRoot: '' })
            set({
              workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
              workspaceLabel: workspaceLabelFromPath('')
            })
          }
        } catch {
          /* silently keep workspaceRoot if settings clear fails */
        }
      }
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
    }
  },

  refreshThreads: async () => {
    if (get().runtimeConnection !== 'ready') return
    try {
      const { providerId } = get()
      const p = getProvider(providerId)
      let rawThreads: NormalizedThread[]
      try {
        rawThreads = await p.listThreads({ limit: 200, includeArchived: true })
      } catch {
        rawThreads = await p.listThreads()
      }
      const threads = rawThreads.map((thread) => ({
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace)
      }))
      const sidebarThreads = await filterThreadsForSidebar(threads, p)
      const forkRegistry = hydrateThreadForkRegistry(sidebarThreads, readThreadForkRegistry())
      saveThreadForkRegistry(forkRegistry)
      const displayThreads = enrichThreadsWithForkInfo(sidebarThreads, forkRegistry)
      const writeWorkspaceRoots = await readWriteWorkspaceRoots()
      const writeRegistry = hydrateWriteThreadRegistry(
        displayThreads,
        writeWorkspaceRoots,
        pruneWriteThreadRegistry(displayThreads, readWriteThreadRegistry())
      )
      saveWriteThreadRegistry(writeRegistry)
      const activeThreadId = get().activeThreadId
      const activeThreadIsWriteInCodeRoute =
        get().route === 'chat' && activeThreadId != null && isWriteThreadId(activeThreadId, writeRegistry)
      const shouldClearSelection =
        activeThreadId != null && !displayThreads.some((thread) => thread.id === activeThreadId)
      if (shouldClearSelection) {
        sseAbort?.abort()
        sseAbort = null
      }
      const validIds = new Set(displayThreads.map((t) => t.id))
      set((s) => {
        const w: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(s.watchTurnCompletion)) {
          if (v && validIds.has(k)) {
            w[k] = true
          } else {
            clearWatchedCompletionNotification(k)
          }
        }
        const u: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(s.unreadThreadIds)) {
          if (v && validIds.has(k)) u[k] = true
        }
        return {
          threads: displayThreads,
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(shouldClearSelection ? clearedThreadSelection() : {})
        }
      })
      syncTurnCompletionPoll(set, get)
      if (activeThreadIsWriteInCodeRoute) {
        await get().openCode()
      }
    } catch (e) {
      stopTurnCompletionPoll()
      set({
        runtimeConnection: 'offline',
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  setThreadSearch: (query) => {
    set({ threadSearch: query })
  },

  setShowArchivedThreads: (show) => {
    set({ showArchivedThreads: show })
    if (show && get().runtimeConnection === 'ready') {
      void get().refreshThreads()
    }
  },

  createThread: async (options = {}) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    try {
      const { providerId } = get()
      const p = getProvider(providerId)
      const settings = await window.dsGui.getSettings()
      const activeThread = get().activeThreadId
        ? get().threads.find((thread) => thread.id === get().activeThreadId)
        : null
      const workspaceRoot =
        normalizeWorkspaceRoot(options.workspaceRoot) ||
        (activeThread && !isInternalTemporaryWorkspace(activeThread.workspace)
          ? normalizeWorkspaceRoot(activeThread.workspace)
          : '') ||
        normalizeWorkspaceRoot(settings.workspaceRoot)
      if (!workspaceRoot) {
        await get().chooseWorkspace({ createThreadAfter: true })
        return
      }
      const reusableThreadId = await findReusableEmptyThreadId(get(), p, workspaceRoot, isCodeThread)
      if (reusableThreadId) {
        if (get().activeThreadId !== reusableThreadId) {
          await get().selectThread(reusableThreadId)
        } else {
          set({ error: null })
        }
        return
      }
      const t = await p.createThread({
        workspace: workspaceRoot,
        title: getDefaultThreadTitle(),
        mode: 'agent'
      })
      await get().refreshThreads()
      await get().selectThread(t.id)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  recoverActiveTurn: async () => {
    const state = get()
    if (!state.activeThreadId) return false
    const { activeThreadId, providerId } = state
    const p = getProvider(providerId)
    sseAbort?.abort()
    sseAbort = null
    clearBusyWatchdog()
    set({ error: i18n.t('common:runtimeStreamRecovering') })
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {}
      } = await p.getThreadDetail(activeThreadId)
      const blocks = hydrateBlockModelLabels(activeThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(blocks, threadStatus)
      const currentTurnUserId = busy
        ? state.currentTurnUserId ?? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const currentTurnId = busy ? state.currentTurnId ?? latestTurnId ?? null : null

      set((s) => ({
        activeThreadId,
        blocks,
        lastSeq: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: busy ? i18n.t('common:runtimeStreamRecovering') : null,
        busy,
        currentTurnId,
        currentTurnUserId,
        turnDurationByUserId,
        queuedMessages: s.queuedMessages
      }))

      const ac = (sseAbort = new AbortController())
      const sink = buildThreadEventSink(set, get)
      void p.subscribeThreadEvents(activeThreadId, latestSeq, sink, ac.signal)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        resetBusyRecoveryAttempts()
        if (get().queuedMessages.length > 0) {
          void get().drainQueuedMessages()
        }
      }
      return busy
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      if (state.busy) armBusyWatchdog(set, get)
      return state.busy
    }
  },

  selectThread: async (id) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const prevId = get().activeThreadId
    const prevBusy = get().busy
    let nextWatch = { ...get().watchTurnCompletion }
    delete nextWatch[id]
    clearWatchedCompletionNotification(id)
    if (prevId && prevId !== id && prevBusy) {
      nextWatch[prevId] = true
      watchCompletionNotificationKeys.set(prevId, `watch:${prevId}:${Date.now()}`)
    }
    const nextUnread = { ...get().unreadThreadIds }
    delete nextUnread[id]

    sseAbort?.abort()
    sseAbort = null
    const { providerId } = get()
    const p = getProvider(providerId)
    try {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {}
      } = await p.getThreadDetail(id)
      const blocks = hydrateBlockModelLabels(id, rawBlocks)
      const busy = threadSnapshotLooksRunning(blocks, threadStatus)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        blocks,
        lastSeq: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        inspectorSelectedId: null,
        queuedMessages: []
      })
      syncTurnCompletionPoll(set, get)
      const ac = sseAbort = new AbortController()
      const sink = buildThreadEventSink(set, get)
      void p.subscribeThreadEvents(id, latestSeq, sink, ac.signal)
      if (busy) armBusyWatchdog(set, get)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  drainQueuedMessages: async () => {
    if (drainingQueuedMessages) return
    drainingQueuedMessages = true
    try {
      while (true) {
        const state = get()
        const next = state.queuedMessages[0]
        if (!next || state.busy) return
        const started = await get().sendMessage(next.text, next.mode, { queued: next })
        if (!started) return
      }
    } finally {
      drainingQueuedMessages = false
    }
  },

  removeQueuedMessage: (id) =>
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id)
    })),

  sendMessage: async (text, mode, overrides) => {
    const { providerId } = get()
    const trimmedText = text.trim()
    if (!trimmedText) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider(providerId)
    if (get().route === 'write') {
      const writeThreadId = await get().ensureWriteThreadForWorkspace()
      if (!writeThreadId) return false
    }
    const hasPendingActiveTurn = get().blocks.some(hasPendingRuntimeWork)
    if (get().busy || hasPendingActiveTurn) {
      const now = Date.now()
      const activeThreadId = get().activeThreadId
      const threadSnap = activeThreadId
        ? get().threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const clawModel = activeClawChannel(get())?.model
      const overrideModel = overrides?.model?.trim()
      const composerModel =
        overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
      const userModelChip =
        overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
      set((s) => ({
        queuedMessages: [
          ...s.queuedMessages,
          {
            id: `q-${now}-${s.queuedMessages.length}`,
            text: trimmedText,
            ...(mode ? { mode } : {}),
            ...(composerModel ? { model: composerModel } : {}),
            ...(userModelChip ? { modelLabel: userModelChip } : {})
          }
        ],
        error: null
      }))
      // UI/runtime can briefly drift (busy=false while runtime still has an active turn).
      // Kick recovery so queued input drains as soon as the in-flight turn settles.
      if (!get().busy && hasPendingActiveTurn) {
        void get().recoverActiveTurn()
      }
      return true
    }
    const now = Date.now()
    const queued = overrides?.queued
    const userBlockId = queued?.id ?? `u-${now}`
    let activeThreadId = get().activeThreadId
    const generatedTitle = deriveThreadTitleFromPrompt(trimmedText)
    const activeThread = activeThreadId
      ? get().threads.find((thread) => thread.id === activeThreadId) ?? null
      : null
    let shouldRenameThreadAfterSend =
      !!activeThreadId &&
      get().blocks.every((block) => block.kind !== 'user') &&
      shouldAutoTitleThread(activeThread)
    const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
    const clawModel = activeClawChannel(get())?.model
    const overrideModel = overrides?.model?.trim()
    const composerModel =
      queued?.model ?? overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    const previousBlocks = get().blocks
    const previousActiveThreadId = get().activeThreadId
    const previousLastSeq = get().lastSeq
    const previousCurrentTurnId = get().currentTurnId
    const previousCurrentTurnUserId = get().currentTurnUserId
    const previousTurnStartedAtByUserId = get().turnStartedAtByUserId
    const previousTurnDurationByUserId = get().turnDurationByUserId
    const previousTurnReasoningFirstAtByUserId = get().turnReasoningFirstAtByUserId
    const previousTurnReasoningLastAtByUserId = get().turnReasoningLastAtByUserId
    const previousQueuedMessages = get().queuedMessages
    resetBusyRecoveryAttempts()
    set((s) => ({
      busy: true,
      blocks: [
        ...s.blocks,
        {
          kind: 'user' as const,
          id: userBlockId,
          createdAt: new Date(now).toISOString(),
          text: trimmedText,
          ...(userModelChip ? { modelLabel: userModelChip } : {})
        }
      ],
      liveReasoning: '',
      liveAssistant: '',
      error: null,
      currentTurnUserId: userBlockId,
      turnStartedAtByUserId: { ...s.turnStartedAtByUserId, [userBlockId]: now },
      queuedMessages: queued ? s.queuedMessages.filter((message) => message.id !== queued.id) : s.queuedMessages
    }))
    if (!activeThreadId) {
      try {
        const settings = await window.dsGui.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          set({
            blocks: previousBlocks,
            busy: false,
            currentTurnId: previousCurrentTurnId,
            currentTurnUserId: previousCurrentTurnUserId,
            turnStartedAtByUserId: previousTurnStartedAtByUserId,
            turnDurationByUserId: previousTurnDurationByUserId,
            turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
            turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
            queuedMessages: previousQueuedMessages,
            error: i18n.t('common:workspaceRequiredToCreateThread')
          })
          return false
        }
        const reusableThreadId = await findReusableEmptyThreadId(get(), p, workspaceRoot, isCodeThread)
        const reusableThread = reusableThreadId
          ? get().threads.find((thread) => thread.id === reusableThreadId) ?? null
          : null
        shouldRenameThreadAfterSend =
          reusableThreadId != null && shouldAutoTitleThread(reusableThread)
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: generatedTitle,
                mode: mode ?? 'agent'
              })
            : null
        const threadId = reusableThreadId ?? createdThread?.id ?? null
        if (!threadId) {
          throw new Error('Failed to resolve target thread id.')
        }
        activeThreadId = threadId
        set((s) => ({
          activeThreadId: threadId,
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
        void get().refreshThreads()
      } catch (e) {
        void window.dsGui.logError('create-thread', 'Failed to create thread', {
          message: e instanceof Error ? e.message : String(e)
        })
        set({
          activeThreadId: previousActiveThreadId,
          blocks: previousBlocks,
          lastSeq: previousLastSeq,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          queuedMessages: previousQueuedMessages,
          error: formatRuntimeError(e),
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
        return false
      }
    }
    sseAbort?.abort()
    sseAbort = null
    clearBusyWatchdog()
    try {
      const seqAtSend = get().lastSeq
      const channel = get().route === 'claw' ? activeClawChannel(get()) : null
      const runtimeText = channel
        ? buildClawRuntimePrompt(await window.dsGui.getSettings(), trimmedText, { channel })
        : trimmedText
      const { turnId, userMessageItemId } = await p.sendUserMessage(activeThreadId, runtimeText, {
        mode,
        ...(composerModel ? { model: composerModel } : {})
      })
      // Mirror the composer model selection against the runtime's stable
      // user_message item id so the badge survives page refresh / thread
      // re-selection. The runtime itself doesn't persist per-turn metadata.
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      if (userMessageItemId && userMessageItemId !== userBlockId) {
        set((s) => ({
          blocks: reconcileOptimisticUserBlock(
            s.blocks,
            userBlockId,
            userMessageItemId,
            trimmedText,
            userModelChip
          ),
          currentTurnUserId: s.currentTurnUserId === userBlockId ? userMessageItemId : s.currentTurnUserId,
          turnStartedAtByUserId: (() => {
            if (s.turnStartedAtByUserId[userBlockId] === undefined) return s.turnStartedAtByUserId
            const next = { ...s.turnStartedAtByUserId, [userMessageItemId]: s.turnStartedAtByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnDurationByUserId: (() => {
            if (s.turnDurationByUserId[userBlockId] === undefined) return s.turnDurationByUserId
            const next = { ...s.turnDurationByUserId, [userMessageItemId]: s.turnDurationByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningFirstAtByUserId: (() => {
            if (s.turnReasoningFirstAtByUserId[userBlockId] === undefined) return s.turnReasoningFirstAtByUserId
            const next = {
              ...s.turnReasoningFirstAtByUserId,
              [userMessageItemId]: s.turnReasoningFirstAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningLastAtByUserId: (() => {
            if (s.turnReasoningLastAtByUserId[userBlockId] === undefined) return s.turnReasoningLastAtByUserId
            const next = {
              ...s.turnReasoningLastAtByUserId,
              [userMessageItemId]: s.turnReasoningLastAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })()
        }))
      }
      if (channel && typeof window.dsGui?.mirrorClawChannelMessageToFeishu === 'function') {
        const userMirror = await window.dsGui.mirrorClawChannelMessageToFeishu(
          activeThreadId,
          trimmedText,
          'user'
        )
        if (userMirror.ok) {
          pendingClawFeishuMirrors.set(turnId, {
            threadId: activeThreadId,
            userBlockId: userMessageItemId ?? userBlockId,
            userText: trimmedText
          })
        }
      }
      if (shouldRenameThreadAfterSend) {
        const renamed = await p.renameThread(activeThreadId, generatedTitle).then(() => true).catch(() => {
          /* keep message delivery successful even if auto-title update fails */
          return false
        })
        if (renamed) {
          set((s) => ({
            threads: s.threads.map((thread) =>
              thread.id === activeThreadId ? { ...thread, title: generatedTitle } : thread
            )
          }))
        }
      }
      set({ currentTurnId: turnId })
      const ac = sseAbort = new AbortController()
      const sink = buildThreadEventSink(set, get)
      void p.subscribeThreadEvents(activeThreadId, seqAtSend, sink, ac.signal)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      void window.dsGui.logError('send-message', 'Failed to send message', {
        message: e instanceof Error ? e.message : String(e),
        threadId: activeThreadId
      })
      if (looksLikeActiveTurnError(e)) {
        set({
          blocks: previousBlocks,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          queuedMessages: previousQueuedMessages,
          error: i18n.t('common:runtimeActiveTurn')
        })
        await get().recoverActiveTurn()
        await get().refreshThreads()
        return false
      }
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        queuedMessages: previousQueuedMessages,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },

  renameActiveThread: async (title) => {
    const { activeThreadId, providerId } = get()
    if (!activeThreadId || !title.trim()) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider(providerId)
    try {
      await p.renameThread(activeThreadId, title.trim())
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  archiveThread: async (threadId, archived) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { providerId, activeThreadId } = get()
    const p = getProvider(providerId)
    const archivingActive = archived && activeThreadId === targetId
    try {
      if (typeof p.archiveThread === 'function') {
        await p.archiveThread(targetId, archived)
      } else if (archived) {
        await p.deleteThread(targetId)
      } else {
        throw new Error(i18n.t('common:runtimeFeatureUnsupported'))
      }
      if (archivingActive) {
        sseAbort?.abort()
        sseAbort = null
        clearBusyWatchdog()
      }
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        const u = { ...s.unreadThreadIds }
        if (archived) {
          delete w[targetId]
          delete u[targetId]
          clearWatchedCompletionNotification(targetId)
        }
        return {
          threads: s.threads.map((thread) =>
            thread.id === targetId ? { ...thread, archived } : thread
          ),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(archivingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  compactActiveThread: async (reason) => {
    const { activeThreadId, providerId, busy } = get()
    if (!activeThreadId) return
    if (busy) {
      set({ error: i18n.t('common:threadActionBusy') })
      return
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider(providerId)
    if (typeof p.compactThread !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      await p.compactThread(activeThreadId, reason)
      await get().refreshThreads()
      await get().selectThread(activeThreadId)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  forkActiveThread: async () => {
    const { activeThreadId, providerId, busy, blocks } = get()
    if (!activeThreadId) return
    if (busy) {
      set({ error: i18n.t('common:threadActionBusy') })
      return
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider(providerId)
    if (typeof p.forkThread !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      const parentThread =
        get().threads.find((thread) => thread.id === activeThreadId) ?? {
          id: activeThreadId,
          title: activeThreadId.slice(0, 8)
        }
      const forked = await p.forkThread(activeThreadId)
      saveThreadForkRegistry(
        markThreadFork(
          forked.id,
          parentThread,
          {
            createdAt: forked.forkedAt ?? new Date().toISOString(),
            forkedFromMessageCount: forked.forkedFromMessageCount ?? forkedMessageCount(blocks),
            forkedFromTurnCount: forked.forkedFromTurnCount ?? forkedTurnCount(blocks)
          },
          readThreadForkRegistry()
        )
      )
      await get().refreshThreads()
      await get().selectThread(forked.id)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  resumeSessionIntoThread: async (sessionId, options) => {
    const id = sessionId.trim()
    if (!id) return null
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    const p = getProvider(get().providerId)
    if (typeof p.resumeSession !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return null
    }
    try {
      const result = await p.resumeSession(id, options)
      await get().refreshThreads()
      await get().selectThread(result.threadId)
      return result.threadId
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

  deleteThread: async (threadId) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { providerId, activeThreadId } = get()
    const p = getProvider(providerId)
    const deletingActive = activeThreadId === targetId
    try {
      await p.deleteThread(targetId)
      saveWriteThreadRegistry(forgetWriteThread(targetId))
      saveThreadForkRegistry(forgetThreadFork(targetId))
      if (deletingActive) {
        sseAbort?.abort()
        sseAbort = null
        clearBusyWatchdog()
      }
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        delete w[targetId]
        clearWatchedCompletionNotification(targetId)
        const u = { ...s.unreadThreadIds }
        delete u[targetId]
        return {
          threads: s.threads.filter((thread) => thread.id !== targetId),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(deletingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  rewindAndResend: async (userBlockId, newText) => {
    const trimmed = newText.trim()
    if (!trimmed) return
    const state = get()
    if (state.busy) {
      set({ error: i18n.t('common:rewindBusyError') })
      return
    }
    const idx = state.blocks.findIndex((b) => b.id === userBlockId && b.kind === 'user')
    if (idx < 0) return

    // Drop the target user block and everything after it. The runtime keeps
    // the old items on disk; this only truncates what the UI shows. A future
    // reload of this thread will surface the old items again — acceptable
    // tradeoff while no rewind endpoint is exposed by the runtime.
    const trimmedBlocks = state.blocks.slice(0, idx)

    const droppedUserIds = state.blocks
      .slice(idx)
      .filter((b) => b.kind === 'user')
      .map((b) => b.id)
    const turnStartedAtByUserId = { ...state.turnStartedAtByUserId }
    const turnDurationByUserId = { ...state.turnDurationByUserId }
    const turnReasoningFirstAtByUserId = { ...state.turnReasoningFirstAtByUserId }
    const turnReasoningLastAtByUserId = { ...state.turnReasoningLastAtByUserId }
    for (const id of droppedUserIds) {
      delete turnStartedAtByUserId[id]
      delete turnDurationByUserId[id]
      delete turnReasoningFirstAtByUserId[id]
      delete turnReasoningLastAtByUserId[id]
    }

    sseAbort?.abort()
    sseAbort = null
    clearBusyWatchdog()

    set({
      blocks: trimmedBlocks,
      liveReasoning: '',
      liveAssistant: '',
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId,
      turnDurationByUserId,
      turnReasoningFirstAtByUserId,
      turnReasoningLastAtByUserId,
      queuedMessages: [],
      error: null
    })

    await get().sendMessage(trimmed)
  },

  resolveApproval: async (blockId, decision) => {
    const { blocks, providerId } = get()
    const block = blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'approval' || block.status !== 'pending') return
    const p = getProvider(providerId)
    if (typeof p.submitApprovalDecision !== 'function') {
      set({ error: 'Current provider does not support approval decisions.' })
      return
    }
    try {
      await p.submitApprovalDecision(
        block.approvalId,
        decision === 'allow' ? 'allow' : 'deny',
        false
      )
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval'
            ? { ...b, status: decision === 'allow' ? ('allowed' as const) : ('denied' as const) }
            : b
        )
      }))
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.dsGui.logError('approval', 'Failed to submit approval decision', {
        message: msg,
        blockId
      })
      set((s) => ({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {}),
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval'
            ? { ...b, status: 'error' as const, errorMessage: msg }
            : b
        )
      }))
    }
  },

  resolveUserInput: async (blockId, action) => {
    const { blocks, providerId } = get()
    const block = blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'user_input' || block.status !== 'pending') return
    const p = getProvider(providerId)
    try {
      if (action.kind === 'submit') {
        const state = get()
        if (typeof p.submitUserInputResponse !== 'function') {
          throw new Error(i18n.t('common:runtimeUserInputUnsupported'))
        }
        try {
          await p.submitUserInputResponse(block.requestId, action.answers)
        } catch (fallbackErr) {
          const activeThreadId = state.activeThreadId
          const currentTurnId = state.currentTurnId
          if (
            getRuntimeErrorCode(fallbackErr) === 'runtime_request_user_input_unsupported' &&
            typeof p.interruptTurn === 'function' &&
            activeThreadId &&
            currentTurnId
          ) {
            const followupText = buildFollowupMessageFromUserInput(block.questions, action.answers)
            set((s) => ({
              queuedMessages: [
                ...s.queuedMessages,
                {
                  id: `q-${Date.now()}-${s.queuedMessages.length}`,
                  text: followupText
                }
              ],
              blocks: s.blocks.map((b) =>
                b.id === blockId && b.kind === 'user_input'
                  ? { ...b, status: 'submitted' as const, answers: action.answers }
                  : b
              )
            }))
            await p.interruptTurn(activeThreadId, currentTurnId)
            if (state.busy) armBusyWatchdog(set, get)
            return
          }
          throw fallbackErr
        }
        if (get().busy) armBusyWatchdog(set, get)
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId && b.kind === 'user_input'
              ? { ...b, status: 'submitted' as const, answers: action.answers }
              : b
          )
        }))
        return
      }

      if (typeof p.cancelUserInput !== 'function') {
        throw new Error(i18n.t('common:runtimeUserInputUnsupported'))
      }
      await p.cancelUserInput(block.requestId)
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? { ...b, status: 'cancelled' as const }
            : b
        )
      }))
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.dsGui.logError('user-input', 'Failed to resolve user input', {
        message: msg,
        blockId
      })
      set((s) => ({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {}),
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? { ...b, status: 'error' as const, errorMessage: msg }
            : b
        )
      }))
    }
  },

  interrupt: async () => {
    const { activeThreadId, currentTurnId, providerId } = get()
    if (!activeThreadId || !currentTurnId) return
    const p = getProvider(providerId)
    try {
      await p.interruptTurn(activeThreadId, currentTurnId)
      clearBusyWatchdog()
      set((s) =>
        flushLiveBlocks(s, {
          ...finalizeTurnTiming(s),
          busy: false,
          currentTurnId: null
        })
      )
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.dsGui.logError('interrupt', 'Failed to interrupt turn', { message: msg })
      set({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  }
}))
