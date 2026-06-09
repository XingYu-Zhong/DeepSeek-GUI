import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

describe('AppShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the macOS app shell on the same full-height flex chain as desktop titlebar platforms', () => {
    vi.stubGlobal('window', {
      dsGui: { platform: 'darwin' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('flex h-full min-h-0 flex-col bg-transparent')
    expect(html).toContain('flex min-h-0 flex-1 flex-col')
    expect(html).not.toContain('ds-windows-titlebar')
  })
})
