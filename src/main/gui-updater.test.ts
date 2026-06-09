import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  forceDevUpdateConfig: boolean
  logger: unknown
  setFeedURL: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

let updater: MockUpdater
let nativeUpdater: EventEmitter

function createUpdater(): MockUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    forceDevUpdateConfig: false,
    logger: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  updater = createUpdater()
  nativeUpdater = new EventEmitter()
  vi.doMock('electron', () => ({
    app: {
      isPackaged: true,
      getAppPath: () => '/tmp/deepseek-gui-updater-test-app',
      getPath: () => '/tmp/deepseek-gui-updater-test-user-data',
      getVersion: () => '0.1.0'
    },
    autoUpdater: nativeUpdater,
    BrowserWindow: class {}
  }))
  vi.doMock('electron-updater', () => ({
    default: { autoUpdater: updater },
    autoUpdater: updater
  }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
  vi.resetModules()
})

describe('installGuiUpdate', () => {
  it('waits for managed runtime cleanup before asking the updater to quit and install', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('reuses the same cleanup when the native updater emits before-quit-for-update', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    nativeUpdater.emit('before-quit-for-update')
    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
