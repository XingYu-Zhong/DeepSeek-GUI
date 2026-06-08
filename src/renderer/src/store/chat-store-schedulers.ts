import type { ChatBlock } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { useTimerState } from './chat-store-timer-state'

type BusyWatchdogOptions = {
  timeoutMs: number
  maxAttempts: number
  finalizeBusyState: (state: ChatState) => Partial<ChatState>
  flushLiveBlocks: (state: ChatState, base: Partial<ChatState>) => Partial<ChatState>
  busyTimeoutMessage: () => string
}

type TurnCompletionPollOptions = {
  loadThreadState: (
    state: ChatState,
    threadId: string
  ) => Promise<{ blocks: ChatBlock[]; threadStatus?: string }>
  threadLooksRunning: (blocks: ChatBlock[], threadStatus?: string) => boolean
  onCompletedThreads: (
    doneIds: string[],
    state: ChatState,
    set: ChatStoreSet,
    get: ChatStoreGet
  ) => void | Promise<void>
}

/**
 * Timer slot accessor. Reads through the zustand singleton rather than
 * a module-level `let`, so the slot map survives hot-reloads and
 * resets cleanly between tests. See `chat-store-timer-state.ts` for
 * the rationale.
 */
function readSlots() {
  return useTimerState.getState().slots
}

function setHandle(
  key: 'startupRuntimeProbe' | 'busyWatchdog' | 'turnCompletionPoll',
  handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null
): void {
  useTimerState.getState().setHandle(key, handle)
}

export function scheduleStartupRuntimeProbe(get: ChatStoreGet): void {
  const existing = readSlots().startupRuntimeProbe
  if (existing) {
    clearTimeout(existing)
  }
  const handle = setTimeout(() => {
    setHandle('startupRuntimeProbe', null)
    void get().probeRuntime('user')
  }, 900)
  setHandle('startupRuntimeProbe', handle)
}

export function clearBusyWatchdog(): void {
  const existing = readSlots().busyWatchdog
  if (existing) {
    clearTimeout(existing)
    setHandle('busyWatchdog', null)
  }
}

export function resetBusyRecoveryAttempts(): void {
  useTimerState.getState().setAttempts(0)
}

export function armBusyWatchdog(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: BusyWatchdogOptions
): void {
  clearBusyWatchdog()
  const handle = setTimeout(() => {
    const state = get()
    if (!state.busy) return
    useTimerState.getState().incrementAttempts()
    const attempts = readSlots().busyRecoveryAttempts
    if (attempts <= options.maxAttempts && state.activeThreadId) {
      void state.recoverActiveTurn()
      return
    }
    set((snapshot) => {
      const base: Partial<ChatState> = {
        ...options.finalizeBusyState(snapshot),
        busy: false,
        currentTurnId: null,
        error: options.busyTimeoutMessage()
      }
      return options.flushLiveBlocks(snapshot, base)
    })
  }, options.timeoutMs)
  setHandle('busyWatchdog', handle)
}

export function stopTurnCompletionPoll(): void {
  const existing = readSlots().turnCompletionPoll
  if (existing) {
    clearInterval(existing)
    setHandle('turnCompletionPoll', null)
  }
}

export function syncTurnCompletionPoll(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): void {
  const ids = Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }
  if (readSlots().turnCompletionPoll != null) return

  const tick = (): void => {
    void pollTurnCompletionWatch(set, get, options)
  }

  const handle = setInterval(tick, 2500)
  setHandle('turnCompletionPoll', handle)
  void tick()
}

async function pollTurnCompletionWatch(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): Promise<void> {
  const state = get()
  if (state.runtimeConnection !== 'ready') {
    stopTurnCompletionPoll()
    return
  }

  const ids = Object.keys(state.watchTurnCompletion).filter((id) => state.watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }

  const doneIds: string[] = []
  for (const threadId of ids) {
    try {
      const { blocks, threadStatus } = await options.loadThreadState(state, threadId)
      if (!options.threadLooksRunning(blocks, threadStatus)) {
        doneIds.push(threadId)
      }
    } catch {
      /* ignore */
    }
  }

  if (doneIds.length > 0) {
    await options.onCompletedThreads(doneIds, state, set, get)
  }

  if (Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id]).length === 0) {
    stopTurnCompletionPoll()
  }
}
