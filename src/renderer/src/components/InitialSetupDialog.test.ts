import { describe, expect, it, vi } from 'vitest'
import {
  canCloseInitialSetup,
  completeInitialSetupAfterSave
} from './InitialSetupDialog'

describe('InitialSetupDialog completion flow', () => {
  it('keeps required first-run setup modal-only until the runtime is ready, then opens Code', async () => {
    const reloadUiSettings = vi.fn(async () => undefined)
    const probeRuntime = vi.fn(async () => undefined)
    const openCode = vi.fn(async () => undefined)
    const closeInitialSetup = vi.fn()
    const setDialogError = vi.fn()

    const completed = await completeInitialSetupAfterSave({
      mode: 'required',
      reloadUiSettings,
      probeRuntime,
      openCode,
      closeInitialSetup,
      getState: () => ({ runtimeConnection: 'ready', error: null }),
      setDialogError,
      fallbackRuntimeError: 'Could not reach Kun.'
    })

    expect(completed).toBe(true)
    expect(reloadUiSettings).toHaveBeenCalledTimes(1)
    expect(probeRuntime).toHaveBeenCalledWith('user')
    expect(openCode).toHaveBeenCalledTimes(1)
    expect(closeInitialSetup).toHaveBeenCalledTimes(1)
    expect(setDialogError).not.toHaveBeenCalled()
  })

  it('does not close required first-run setup when the runtime cannot connect', async () => {
    const closeInitialSetup = vi.fn()
    const openCode = vi.fn(async () => undefined)
    const setDialogError = vi.fn()

    const completed = await completeInitialSetupAfterSave({
      mode: 'required',
      reloadUiSettings: vi.fn(async () => undefined),
      probeRuntime: vi.fn(async () => undefined),
      openCode,
      closeInitialSetup,
      getState: () => ({ runtimeConnection: 'offline', error: 'Port is busy.' }),
      setDialogError,
      fallbackRuntimeError: 'Could not reach Kun.'
    })

    expect(completed).toBe(false)
    expect(openCode).not.toHaveBeenCalled()
    expect(closeInitialSetup).not.toHaveBeenCalled()
    expect(setDialogError).toHaveBeenCalledWith('Port is busy.')
  })

  it('keeps preview setup dismissible and avoids forcing the user into Code', async () => {
    const probeRuntime = vi.fn(async () => undefined)
    const openCode = vi.fn(async () => undefined)
    const closeInitialSetup = vi.fn()

    const completed = await completeInitialSetupAfterSave({
      mode: 'preview',
      reloadUiSettings: vi.fn(async () => undefined),
      probeRuntime,
      openCode,
      closeInitialSetup,
      getState: () => ({ runtimeConnection: 'offline', error: null }),
      setDialogError: vi.fn(),
      fallbackRuntimeError: 'Could not reach Kun.'
    })

    expect(completed).toBe(true)
    expect(probeRuntime).toHaveBeenCalledWith('background')
    expect(openCode).not.toHaveBeenCalled()
    expect(closeInitialSetup).toHaveBeenCalledTimes(1)
  })

  it('only allows manual close in preview mode', () => {
    expect(canCloseInitialSetup('required')).toBe(false)
    expect(canCloseInitialSetup('preview')).toBe(true)
  })
})
