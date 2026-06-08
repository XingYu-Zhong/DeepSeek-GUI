import { create } from 'zustand'

/**
 * Singleton timer slot holder for the chat store.
 *
 * ## Why a store instead of module-level `let`?
 *
 * The previous design kept four timer handles as module-scoped
 * `let` variables in `chat-store-schedulers.ts`. That worked at
 * runtime but had two problems:
 *
 *   1. **HMR hazard.** When vite replaces the module on hot-reload,
 *      the old timer handles are still alive in the previous module
 *      instance, but the new module's `let` slots are null. A
 *      subsequent `armBusyWatchdog` call writes to the new slot, the
 *      old timer fires and calls the old module's `get()`, which is
 *      bound to a stale zustand snapshot.
 *
 *   2. **Test isolation.** Each test file imports the schedulers
 *      module once. Without a way to reset the slot map, tests have
 *      to leak state into each other.
 *
 * A zustand singleton is the lightest fix that satisfies both: HMR
 * replaces the store reference (Vite tracks module-level `create()`
 * returns), and `useTimerState.getState().reset()` cleanly zeros the
 * slots between tests.
 *
 * ## The HMR dispose hook
 *
 * Even with a zustand singleton, the live `setTimeout` / `setInterval`
 * handles survive module replacement. The `import.meta.hot?.dispose`
 * block below clears them so that no late callback from a previous
 * module instance can fire against the new store.
 */
type TimerHandle = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

type TimerSlots = {
  /** Timer for the initial runtime probe fired shortly after boot. */
  startupRuntimeProbe: TimerHandle | null
  /** Watchdog timer that fires when a turn takes too long. */
  busyWatchdog: TimerHandle | null
  /**
   * Counter, not a handle. Tracks how many times the watchdog has
   * fired for the current turn; reset on the first event in any new
   * turn. Kept in the same slot map for cohesion.
   */
  busyRecoveryAttempts: number
  /** Polling interval for the "is this turn still running?" check. */
  turnCompletionPoll: TimerHandle | null
}

type TimerState = {
  slots: TimerSlots
  setHandle: (
    key: 'startupRuntimeProbe' | 'busyWatchdog' | 'turnCompletionPoll',
    handle: TimerHandle | null
  ) => void
  setAttempts: (n: number) => void
  incrementAttempts: () => void
  reset: () => void
}

const empty: TimerSlots = {
  startupRuntimeProbe: null,
  busyWatchdog: null,
  busyRecoveryAttempts: 0,
  turnCompletionPoll: null
}

export const useTimerState = create<TimerState>((set) => ({
  slots: { ...empty },
  setHandle: (key, handle) =>
    set((s) => ({ slots: { ...s.slots, [key]: handle } })),
  setAttempts: (n) =>
    set((s) => ({ slots: { ...s.slots, busyRecoveryAttempts: n } })),
  incrementAttempts: () =>
    set((s) => ({
      slots: { ...s.slots, busyRecoveryAttempts: s.slots.busyRecoveryAttempts + 1 }
    })),
  reset: () => set({ slots: { ...empty } })
}))

/**
 * HMR safety net: when vite swaps this module out, any timers set
 * by the previous module instance are still alive. Clear them here
 * so that no late callback from a previous instance fires against
 * the new store. `import.meta.hot` is undefined in production builds.
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const s = useTimerState.getState().slots
    if (s.startupRuntimeProbe) clearTimeout(s.startupRuntimeProbe)
    if (s.busyWatchdog) clearTimeout(s.busyWatchdog)
    if (s.turnCompletionPoll) clearInterval(s.turnCompletionPoll)
    useTimerState.getState().reset()
  })
}
