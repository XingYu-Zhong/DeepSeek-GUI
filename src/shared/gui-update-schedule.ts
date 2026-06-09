export const GUI_UPDATE_DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export function nextGuiUpdateCheckDelay(
  lastCheckedAtMs: number | null | undefined,
  nowMs = Date.now()
): number {
  if (!Number.isFinite(lastCheckedAtMs) || !lastCheckedAtMs || lastCheckedAtMs <= 0) return 0
  return Math.max(0, lastCheckedAtMs + GUI_UPDATE_DAILY_CHECK_INTERVAL_MS - nowMs)
}
