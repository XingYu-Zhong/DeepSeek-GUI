import { describe, expect, it } from 'vitest'
import {
  canUseElectronWebviewEnvironment,
  resolveInitialDevBrowserUrl
} from './DevBrowserPanel'

describe('DevBrowserPanel webview environment detection', () => {
  it('requires the Electron user agent in addition to the shell bridge', () => {
    expect(
      canUseElectronWebviewEnvironment({
        openExternalAvailable: true,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
      })
    ).toBe(false)
  })

  it('allows Electron renderer environments with the shell bridge', () => {
    expect(
      canUseElectronWebviewEnvironment({
        openExternalAvailable: true,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/132 Safari/537.36 Electron/34.2.0'
      })
    ).toBe(true)
  })

  it('rejects Electron-like pages when the shell bridge is absent', () => {
    expect(
      canUseElectronWebviewEnvironment({
        openExternalAvailable: false,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/132 Safari/537.36 Electron/34.2.0'
      })
    ).toBe(false)
  })
})

describe('DevBrowserPanel initial URL resolution', () => {
  it('stays blank when no preview URL source exists', () => {
    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: null,
        storedUrl: null,
        latestDetectedUrl: null
      })
    ).toBeNull()
  })

  it('prefers explicit preview URL sources in order', () => {
    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: 'http://localhost:3000/',
        storedUrl: 'http://localhost:4000/',
        latestDetectedUrl: 'http://localhost:5000/'
      })
    ).toBe('http://localhost:3000/')

    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: null,
        storedUrl: 'http://localhost:4000/',
        latestDetectedUrl: 'http://localhost:5000/'
      })
    ).toBe('http://localhost:4000/')

    expect(
      resolveInitialDevBrowserUrl({
        normalizedPreferredUrl: null,
        storedUrl: null,
        latestDetectedUrl: 'http://localhost:5000/'
      })
    ).toBe('http://localhost:5000/')
  })
})
