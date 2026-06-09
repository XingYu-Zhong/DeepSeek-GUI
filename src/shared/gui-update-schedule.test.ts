import { describe, expect, it } from 'vitest'
import {
  GUI_UPDATE_DAILY_CHECK_INTERVAL_MS,
  nextGuiUpdateCheckDelay
} from './gui-update-schedule'

describe('nextGuiUpdateCheckDelay', () => {
  it('checks immediately when there is no previous check', () => {
    expect(nextGuiUpdateCheckDelay(null, 1_000)).toBe(0)
    expect(nextGuiUpdateCheckDelay(undefined, 1_000)).toBe(0)
    expect(nextGuiUpdateCheckDelay(0, 1_000)).toBe(0)
  })

  it('waits until a full day has elapsed', () => {
    const now = Date.UTC(2026, 4, 26, 12, 0, 0)
    const lastCheckedAt = now - 3_600_000
    expect(nextGuiUpdateCheckDelay(lastCheckedAt, now)).toBe(
      GUI_UPDATE_DAILY_CHECK_INTERVAL_MS - 3_600_000
    )
  })

  it('checks immediately once the next daily window is reached', () => {
    const now = Date.UTC(2026, 4, 26, 12, 0, 0)
    const lastCheckedAt = now - GUI_UPDATE_DAILY_CHECK_INTERVAL_MS - 60_000
    expect(nextGuiUpdateCheckDelay(lastCheckedAt, now)).toBe(0)
  })
})
