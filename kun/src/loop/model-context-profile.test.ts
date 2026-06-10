import { describe, expect, it } from 'vitest'
import { contextThresholdsForModel } from './model-context-profile.js'

describe('contextThresholdsForModel safety cap', () => {
  it('caps soft/hard thresholds to 75%/85% of the context window', () => {
    // A config-provided profile that sets thresholds dangerously close to
    // the full window (98%/99%) must be clamped so compaction still has
    // headroom to run before the real window is exceeded.
    const profiles = [
      {
        canonicalModel: 'deepseek-v4-pro',
        modelIds: ['deepseek-v4-pro'] as readonly string[],
        contextWindowTokens: 1_000_000,
        softThreshold: 980_000,
        hardThreshold: 990_000,
        inputModalities: ['text'] as const,
        outputModalities: ['text'] as const,
        supportsToolCalling: true,
        messageParts: ['text'] as const
      }
    ]
    const thresholds = contextThresholdsForModel('deepseek-v4-pro', undefined, profiles)
    expect(thresholds.softThreshold).toBe(750_000)
    expect(thresholds.hardThreshold).toBe(850_000)
  })

  it('leaves already-safe thresholds untouched', () => {
    const profiles = [
      {
        canonicalModel: 'deepseek-v4-pro',
        modelIds: ['deepseek-v4-pro'] as readonly string[],
        contextWindowTokens: 1_000_000,
        softThreshold: 500_000,
        hardThreshold: 600_000,
        inputModalities: ['text'] as const,
        outputModalities: ['text'] as const,
        supportsToolCalling: true,
        messageParts: ['text'] as const
      }
    ]
    const thresholds = contextThresholdsForModel('deepseek-v4-pro', undefined, profiles)
    expect(thresholds.softThreshold).toBe(500_000)
    expect(thresholds.hardThreshold).toBe(600_000)
  })

  it('returns the fallback when no profile matches', () => {
    const fallback = { softThreshold: 1234, hardThreshold: 5678 }
    const thresholds = contextThresholdsForModel('unknown-model', fallback, [])
    expect(thresholds).toEqual(fallback)
  })
})
