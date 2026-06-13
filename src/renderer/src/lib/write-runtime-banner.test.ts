import { describe, expect, it } from 'vitest'
import { resolveWriteRuntimeBannerMessage } from './write-runtime-banner'

describe('resolveWriteRuntimeBannerMessage', () => {
  it('does not show the Write banner for routine offline editing', () => {
    expect(resolveWriteRuntimeBannerMessage({
      runtimeConnection: 'offline',
      error: null,
      runtimeActionNeedsConnection: 'Connect to the runtime before using AI actions.'
    })).toBeNull()
  })

  it('suppresses generic runtime connection hints from sidebar actions', () => {
    expect(resolveWriteRuntimeBannerMessage({
      runtimeConnection: 'offline',
      error: '  Connect to the runtime before using AI actions.  ',
      runtimeActionNeedsConnection: 'Connect to the runtime before using AI actions.'
    })).toBeNull()
  })

  it('keeps actionable runtime failures visible', () => {
    expect(resolveWriteRuntimeBannerMessage({
      runtimeConnection: 'offline',
      error: 'The runtime port is already in use.',
      runtimeActionNeedsConnection: 'Connect to the runtime before using AI actions.'
    })).toBe('The runtime port is already in use.')
  })

  it('hides the Write banner after the runtime reconnects', () => {
    expect(resolveWriteRuntimeBannerMessage({
      runtimeConnection: 'ready',
      error: 'The runtime port is already in use.',
      runtimeActionNeedsConnection: 'Connect to the runtime before using AI actions.'
    })).toBeNull()
  })
})
