/**
 * Port for time. The default implementation uses `Date.now` and `new Date`;
 * tests can inject a deterministic clock to reason about expiry windows.
 */
export interface Clock {
  now(): Date
  nowIso(): string
  nowMs(): number
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now()
}
