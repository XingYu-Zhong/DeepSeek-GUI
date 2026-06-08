import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
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
import { isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildClawRuntimePrompt, getActiveAgentApiKey } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  activeClawChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  reconcileOptimisticUserBlock,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
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
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import {
  isSddAssistantThread,
  readSddThreadRegistry
} from '../sdd/sdd-thread-registry'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  readActiveWriteWorkspace,
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let bootPromise: Promise<void> | null = null
let clawChannelActivityUnsubscribe: (() => void) | null = null

/**
 * Detach the IPC listener registered during `boot()`. Safe to call
 * multiple times. The listener is intentionally module-scoped (not
 * stored in the zustand state) because it is registered exactly once
 * for the app's lifetime and never changes — storing it in `ChatState`
 * would force every `set(...)` to preserve the field, and it would
 * leak into devtools / selectors.
 */
export function teardownClawChannelActivityListener(): void {
  if (clawChannelActivityUnsubscribe) {
    try {
      clawChannelActivityUnsubscribe()
    } catch {
      /* listener may already be detached by the IPC layer */
    }
    clawChannelActivityUnsubscribe = null
  }
}

export function createNavigationActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'openCode' | 'openWrite' | 'ensureWriteThreadForWorkspace' | 'createWriteThread' | 'selectWriteThread' | 'probeRuntime' | 'boot' | 'chooseWorkspace' | 'clearWorkspace' | 'deleteWorkspace' | 'refreshThreads' | 'setThreadSearch' | 'setShowArchivedThreads'> {
  return {
  openCode: async () => {
    const state = get()
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (activeThread && isCodeThread(activeThread, state.clawChannels)) {
      set({ route: 'chat' })
      return
    }

    const codeThreads = state.threads.filter((thread) => isCodeThread(thread, state.clawChannels))
    const selectedWorkspace = normalizeWorkspaceRoot(state.workspaceRoot)
    const target =
      latestThread(codeThreads.filter((thread) => threadBelongsToWorkspace(thread, selectedWorkspace))) ??
      latestThread(codeThreads)

    set({ route: 'chat' })
    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id)
      return
    }

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(state.activeThreadId)
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

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(state.activeThreadId)
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
      const p = getProvider()
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
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      const p = getProvider()
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
        // SSE 事件 sink（onSeq / onDeltas / onError / onTurnComplete）已经在
        // 每个事件时 reset；这里补一个"连接明确变 offline"的兜底点，
        // 处理 SSE 硬断导致 onError 不触发的边界情况。
        resetBusyRecoveryAttempts()
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
        resetBusyRecoveryAttempts()
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
        const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(readCodeWorkspaceRoots(), [workspaceRoot])
        const needsInitialSetup = !getActiveAgentApiKey(settings).trim()
        applyTheme(settings.theme)
        applyUiFontScale(settings.uiFontScale)
        await get().applyI18nFromSettings(settings.locale)
        if (!clawChannelActivityUnsubscribe && typeof window.dsGui.onClawChannelActivity === 'function') {
          clawChannelActivityUnsubscribe = window.dsGui.onClawChannelActivity(({ channelId, threadId }) => {
            void (async () => {
              const state = get()
              if (typeof window.dsGui === 'undefined') return
              const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
              const channels = settings.claw.channels
              const activeChannelId = channels.some(
                (channel) => channel.id === state.activeClawChannelId && channel.enabled
              )
                ? state.activeClawChannelId
                : channels.find((channel) => channel.enabled)?.id ?? ''
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
          workspaceRoot,
          codeWorkspaceRoots,
          workspaceLabel: workspaceLabelFromPath(workspaceRoot),
          clawChannels: settings.claw.channels,
          activeClawChannelId: settings.claw.channels.find((channel) => channel.enabled)?.id ?? '',
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

  chooseWorkspace: async ({ createThreadAfter = false, selectThreadAfter = true } = {}) => {
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
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: picked.path })
      const workspaceRoot = normalizeWorkspaceRoot(next.workspaceRoot)
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
      set({
        workspaceRoot,
        codeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        error: null
      })
      await get().refreshThreads()
      if (workspaceRoot) {
        if (!selectThreadAfter) return workspaceRoot
        if (wasWriteRoute) {
          await get().openWrite()
          return workspaceRoot
        }
        const workspaceThreads = get().threads
          .filter((thread) => isCodeThread(thread, get().clawChannels))
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
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
      set({
        workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
        codeWorkspaceRoots: get().codeWorkspaceRoots,
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
    const { activeThreadId } = get()
    const p = getProvider()
    const workspaceThreads = get().threads.filter((thread) =>
      threadBelongsToWorkspace(thread, normalizedPath)
    )
    const deletingActive = workspaceThreads.some((th) => th.id === activeThreadId)
    if (deletingActive) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    try {
      for (const th of workspaceThreads) {
        await p.deleteThread(th.id)
      }
      const removeIds = new Set(workspaceThreads.map((th) => th.id))
      const codeWorkspaceRoots = forgetCodeWorkspaceRoot(get().codeWorkspaceRoots, normalizedPath)
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
          codeWorkspaceRoots,
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
            const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
            set({
              workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
              codeWorkspaceRoots: get().codeWorkspaceRoots,
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
      const p = getProvider()
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
      const sddThreadRegistry = readSddThreadRegistry()
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(
        get().codeWorkspaceRoots,
        threads
          .filter((thread) => isCodeThread(thread, get().clawChannels))
          .map((thread) => thread.workspace)
      )
      const sidebarThreads = (await filterThreadsForSidebar(threads, p))
        .filter((thread) => !isSddAssistantThread(thread, sddThreadRegistry))
      const forkRegistry = hydrateThreadForkRegistry(sidebarThreads, readThreadForkRegistry())
      saveThreadForkRegistry(forkRegistry)
      const enrichedThreads = enrichThreadsWithForkInfo(sidebarThreads, forkRegistry)
      // Preserve the active Kun thread when it is not in the listing yet.
      // A brand-new thread can be absent from `listThreads` until the first
      // message is written. Without this, the optimistic thread would be wiped
      // from the sidebar and its live turn aborted by the selection clearing
      // path below.
      const activeId = get().activeThreadId
      const activeRawThread = activeId
        ? threads.find((thread) => thread.id === activeId) ?? null
        : null
      const activeThreadIsSdd =
        isSddAssistantThread(activeRawThread, sddThreadRegistry) ||
        isSddAssistantThread(
          activeId ? get().threads.find((thread) => thread.id === activeId) ?? null : null,
          sddThreadRegistry
        )
      const activeThreadFilteredFromCodeSidebar =
        get().route === 'chat' &&
        activeId != null &&
        !activeThreadIsSdd &&
        threads.some((thread) => thread.id === activeId) &&
        !sidebarThreads.some((thread) => thread.id === activeId)
      const preservedSddActiveThread =
        activeThreadIsSdd && activeId
          ? activeRawThread ?? get().threads.find((thread) => thread.id === activeId) ?? null
          : null
      const pendingActiveThread =
        activeId != null &&
        !activeThreadFilteredFromCodeSidebar &&
        !enrichedThreads.some((thread) => thread.id === activeId)
          ? get().threads.find((thread) => thread.id === activeId) ?? null
          : null
      let displayThreads = pendingActiveThread
        ? [pendingActiveThread, ...enrichedThreads]
        : enrichedThreads
      if (
        preservedSddActiveThread &&
        !displayThreads.some((thread) => thread.id === preservedSddActiveThread.id)
      ) {
        displayThreads = [preservedSddActiveThread, ...displayThreads]
      }
      const writeWorkspaceRoots = await readWriteWorkspaceRoots()
      const writeRegistry = hydrateWriteThreadRegistry(
        displayThreads,
        writeWorkspaceRoots,
        pruneWriteThreadRegistry(displayThreads, readWriteThreadRegistry())
      )
      saveWriteThreadRegistry(writeRegistry)
      displayThreads = displayThreads.map((thread) => {
        const writeWorkspace = writeWorkspaceForThreadId(thread.id, writeRegistry)
        return writeWorkspace ? { ...thread, workspace: writeWorkspace } : thread
      })
      const activeThreadId = get().activeThreadId
      const activeThread = activeThreadId
        ? displayThreads.find((thread) => thread.id === activeThreadId) ?? null
        : null
      const activeThreadIsManagedInCodeRoute =
        get().route === 'chat' &&
        activeThread != null &&
        (isWriteThreadId(activeThread.id, writeRegistry) ||
          isClawThread(activeThread, get().clawChannels))
      const shouldClearSelection =
        activeThreadId != null && !displayThreads.some((thread) => thread.id === activeThreadId)
      if (shouldClearSelection) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
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
          codeWorkspaceRoots: compactCodeWorkspaceRoots([
            ...displayThreads
              .filter((thread) => isCodeThread(thread, s.clawChannels))
              .map((thread) => thread.workspace),
            ...codeWorkspaceRoots
          ]),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(shouldClearSelection ? clearedThreadSelection() : {})
        }
      })
      syncTurnCompletionPoll(set, get)
      if (activeThreadIsManagedInCodeRoute) {
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
      resetBusyRecoveryAttempts()
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
  }
}
